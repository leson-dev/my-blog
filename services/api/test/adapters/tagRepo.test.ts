import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { toTagItem } from "../../src/adapters/dynamo/items";
import { DynamoTagRepository } from "../../src/adapters/dynamo/tagRepo";

const ddb = mockClient(DynamoDBDocumentClient);
const repo = new DynamoTagRepository(
  DynamoDBDocumentClient.from(new DynamoDBClient({ region: "ap-northeast-1" })),
  "BlogTable",
);

beforeEach(() => ddb.reset());

describe("DynamoTagRepository", () => {
  it("lists TAG items from the byUpdated index in key order", async () => {
    ddb
      .on(QueryCommand)
      .resolvesOnce({
        Items: [toTagItem({ key: "aws", names: {} })],
        LastEvaluatedKey: { PK: "TAG#aws" },
      })
      .resolvesOnce({ Items: [toTagItem({ key: "life", names: { ja: "暮らし" } })] });
    expect(await repo.list()).toEqual([
      { key: "aws", names: {} },
      { key: "life", names: { ja: "暮らし" } },
    ]);
    expect(ddb.commandCalls(QueryCommand)[0]?.args[0].input).toMatchObject({
      IndexName: "byUpdated",
      ScanIndexForward: true,
      ExpressionAttributeValues: { ":pk": "TAG" },
    });
  });

  it("writes a tag item keyed by TAG#<key>", async () => {
    ddb.on(PutCommand).resolves({});
    await repo.put({ key: "life", names: { vi: "đời sống" } });
    expect(ddb.commandCalls(PutCommand)[0]?.args[0].input.Item).toEqual({
      PK: "TAG#life",
      SK: "TAG",
      GSI1PK: "TAG",
      GSI1SK: "life",
      key: "life",
      names: { vi: "đời sống" },
    });
  });
});
