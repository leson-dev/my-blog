import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
} from "@aws-sdk/client-dynamodb";
import {
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Lang, Post } from "@blog/shared";
import { DomainError } from "../../domain/errors";
import { slugEntries } from "../../domain/post";
import type { PostRepository } from "../../usecases/ports";
import { fromPostItem, postKey, slugKey, toPostItem } from "./items";
import { queryIndex } from "./queryIndex";

const versionConflict = () =>
  new DomainError("VERSION_CONFLICT", "post was modified elsewhere, reload and try again");
const slugTaken = (slug: string) =>
  new DomainError("SLUG_TAKEN", `slug "${slug}" is already used by another post or language`);

const firstFailed = (err: TransactionCanceledException) =>
  err.CancellationReasons?.findIndex((r) => r.Code === "ConditionalCheckFailed") ?? -1;

type SlugEntry = { lang: Lang; slug: string };

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
    return (await queryIndex(this.db, this.tableName, "POST", true)).map(fromPostItem);
  }

  async create(post: Post): Promise<void> {
    const slugs = slugEntries(post);
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
            ...slugs.map((entry) => this.reserve(post.id, entry)),
          ],
        }),
      );
    } catch (err) {
      if (err instanceof TransactionCanceledException) {
        const failed = slugs[firstFailed(err) - 1];
        if (failed) throw slugTaken(failed.slug);
      }
      throw err;
    }
  }

  async update(next: Post, prev: Post): Promise<void> {
    const before = new Map(slugEntries(prev).map((e) => [e.lang, e.slug]));
    const after = new Map(slugEntries(next).map((e) => [e.lang, e.slug]));
    const added = slugEntries(next).filter((e) => before.get(e.lang) !== e.slug);
    const removed = slugEntries(prev).filter((e) => after.get(e.lang) !== e.slug);

    const putPost = {
      TableName: this.tableName,
      Item: toPostItem(next),
      ConditionExpression: "#v = :v",
      ExpressionAttributeNames: { "#v": "version" },
      ExpressionAttributeValues: { ":v": prev.version },
    };

    if (added.length === 0 && removed.length === 0) {
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
            ...added.map((entry) => this.reserve(next.id, entry)),
            ...removed.map((entry) => ({
              Delete: { TableName: this.tableName, Key: slugKey(entry.slug) },
            })),
          ],
        }),
      );
    } catch (err) {
      if (err instanceof TransactionCanceledException) {
        const index = firstFailed(err);
        if (index === 0) throw versionConflict();
        const failed = added[index - 1];
        if (failed) throw slugTaken(failed.slug);
      }
      throw err;
    }
  }

  async delete(post: Post): Promise<void> {
    await this.db.send(
      new TransactWriteCommand({
        TransactItems: [
          { Delete: { TableName: this.tableName, Key: postKey(post.id) } },
          ...slugEntries(post).map((entry) => ({
            Delete: { TableName: this.tableName, Key: slugKey(entry.slug) },
          })),
        ],
      }),
    );
  }

  private reserve(postId: string, entry: SlugEntry) {
    return {
      Put: {
        TableName: this.tableName,
        Item: { ...slugKey(entry.slug), postId, lang: entry.lang },
        ConditionExpression: "attribute_not_exists(PK)",
      },
    };
  }
}
