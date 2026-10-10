import { type DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { BUILD_KEY } from "@blog/api/dynamo";

export type BuildPhase = "running" | "success" | "failed";

/** Writes BUILD/LATEST, read by the admin through GET /builds/latest. */
export class DynamoBuildStatus {
  private readonly db: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(db: DynamoDBDocumentClient, tableName: string) {
    this.db = db;
    this.tableName = tableName;
  }

  async set(status: BuildPhase, now: string, error: string | null = null): Promise<void> {
    await this.db.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { ...BUILD_KEY, status, updatedAt: now, error },
      }),
    );
  }
}
