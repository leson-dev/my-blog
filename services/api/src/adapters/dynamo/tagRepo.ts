import { type DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { Tag } from "@blog/shared";
import type { TagRepository } from "../../usecases/ports";
import { fromTagItem, toTagItem } from "./items";
import { queryIndex } from "./queryIndex";

export class DynamoTagRepository implements TagRepository {
  private readonly db: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(db: DynamoDBDocumentClient, tableName: string) {
    this.db = db;
    this.tableName = tableName;
  }

  async list(): Promise<Tag[]> {
    return (await queryIndex(this.db, this.tableName, "TAG", false)).map(fromTagItem);
  }

  async put(tag: Tag): Promise<void> {
    await this.db.send(new PutCommand({ TableName: this.tableName, Item: toTagItem(tag) }));
  }
}
