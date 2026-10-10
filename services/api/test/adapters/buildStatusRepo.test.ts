import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { DynamoBuildStatusRepository } from "../../src/adapters/dynamo/buildStatusRepo";

const ddb = mockClient(DynamoDBDocumentClient);
const repo = new DynamoBuildStatusRepository(
  DynamoDBDocumentClient.from(new DynamoDBClient({ region: "ap-northeast-1" })),
  "BlogTable",
);

beforeEach(() => ddb.reset());

describe("DynamoBuildStatusRepository", () => {
  it("reports idle when no build ever ran", async () => {
    ddb.on(GetCommand).resolves({});
    expect(await repo.get()).toEqual({ status: "idle", updatedAt: null, error: null });
  });

  it("reads the stored state", async () => {
    ddb.on(GetCommand).resolves({
      Item: { PK: "BUILD", SK: "LATEST", status: "success", updatedAt: "t", error: null },
    });
    expect(await repo.get()).toEqual({ status: "success", updatedAt: "t", error: null });
  });

  it("writes queued and failed states to BUILD/LATEST", async () => {
    ddb.on(PutCommand).resolves({});
    await repo.setQueued("t1");
    await repo.setFailed("t2", "boom");
    const items = ddb.commandCalls(PutCommand).map((c) => c.args[0].input.Item);
    expect(items).toEqual([
      { PK: "BUILD", SK: "LATEST", status: "queued", updatedAt: "t1", error: null },
      { PK: "BUILD", SK: "LATEST", status: "failed", updatedAt: "t2", error: "boom" },
    ]);
  });
});
