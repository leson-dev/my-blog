import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
} from "@aws-sdk/client-dynamodb";
import {
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Post } from "@blog/shared";
import { DomainError } from "../../domain/errors";
import type { PostRepository } from "../../usecases/ports";
import { fromPostItem, POSTS_INDEX, postKey, slugKey, toPostItem } from "./items";

const versionConflict = () =>
  new DomainError("VERSION_CONFLICT", "post was modified elsewhere, reload and try again");
const slugTaken = (slug: string) =>
  new DomainError("SLUG_TAKEN", `slug "${slug}" is already used by another post`);

const failedAt = (err: TransactionCanceledException, index: number) =>
  err.CancellationReasons?.[index]?.Code === "ConditionalCheckFailed";

export class DynamoPostRepository implements PostRepository {
  private readonly db: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(db: DynamoDBDocumentClient, tableName: string) {
    this.db = db;
    this.tableName = tableName;
  }

  async get(id: string): Promise<Post | null> {
    const res = await this.db.send(new GetCommand({ TableName: this.tableName, Key: postKey(id) }));
    return res.Item ? fromPostItem(res.Item) : null;
  }

  async list(): Promise<Post[]> {
    const posts: Post[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const res = await this.db.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: POSTS_INDEX,
          KeyConditionExpression: "GSI1PK = :pk",
          ExpressionAttributeValues: { ":pk": "POST" },
          ScanIndexForward: false,
          ExclusiveStartKey: startKey,
        }),
      );
      posts.push(...(res.Items ?? []).map(fromPostItem));
      startKey = res.LastEvaluatedKey;
    } while (startKey);
    return posts;
  }

  async create(post: Post): Promise<void> {
    try {
      await this.db.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.tableName,
                Item: toPostItem(post),
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
            {
              Put: {
                TableName: this.tableName,
                Item: { ...slugKey(post.slug), postId: post.id },
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
          ],
        }),
      );
    } catch (err) {
      if (err instanceof TransactionCanceledException && failedAt(err, 1)) {
        throw slugTaken(post.slug);
      }
      throw err;
    }
  }

  async update(next: Post, prev: Post): Promise<void> {
    const putPost = {
      TableName: this.tableName,
      Item: toPostItem(next),
      ConditionExpression: "#v = :v",
      ExpressionAttributeNames: { "#v": "version" },
      ExpressionAttributeValues: { ":v": prev.version },
    };

    if (next.slug === prev.slug) {
      try {
        await this.db.send(new PutCommand(putPost));
      } catch (err) {
        if (err instanceof ConditionalCheckFailedException) throw versionConflict();
        throw err;
      }
      return;
    }

    try {
      await this.db.send(
        new TransactWriteCommand({
          TransactItems: [
            { Put: putPost },
            {
              Put: {
                TableName: this.tableName,
                Item: { ...slugKey(next.slug), postId: next.id },
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
            { Delete: { TableName: this.tableName, Key: slugKey(prev.slug) } },
          ],
        }),
      );
    } catch (err) {
      if (err instanceof TransactionCanceledException) {
        if (failedAt(err, 0)) throw versionConflict();
        if (failedAt(err, 1)) throw slugTaken(next.slug);
      }
      throw err;
    }
  }

  async delete(post: Post): Promise<void> {
    await this.db.send(
      new TransactWriteCommand({
        TransactItems: [
          { Delete: { TableName: this.tableName, Key: postKey(post.id) } },
          { Delete: { TableName: this.tableName, Key: slugKey(post.slug) } },
        ],
      }),
    );
  }
}
