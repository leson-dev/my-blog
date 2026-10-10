import { type DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { BuildState, BuildStatus } from "@blog/shared";
import type { BuildStatusRepository } from "../../usecases/ports";
import { BUILD_KEY } from "./items";

export class DynamoBuildStatusRepository implements BuildStatusRepository {
  private readonly db: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(db: DynamoDBDocumentClient, tableName: string) {
    this.db = db;
    this.tableName = tableName;
  }

  async get(): Promise<BuildState> {
    const res = await this.db.send(new GetCommand({ TableName: this.tableName, Key: BUILD_KEY }));
    if (!res.Item) return { status: "idle", updatedAt: null, error: null };
    return {
      status: res.Item.status as BuildStatus,
      updatedAt: (res.Item.updatedAt as string | undefined) ?? null,
      error: (res.Item.error as string | null | undefined) ?? null,
    };
  }

  setQueued(now: string): Promise<void> {
    return this.write({ status: "queued", updatedAt: now, error: null });
  }

  setFailed(now: string, error: string): Promise<void> {
    return this.write({ status: "failed", updatedAt: now, error });
  }

  private async write(state: BuildState): Promise<void> {
    await this.db.send(
      new PutCommand({ TableName: this.tableName, Item: { ...BUILD_KEY, ...state } }),
    );
  }
}
