import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  TransactionCanceledException,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { toPostItem } from "../../src/adapters/dynamo/items";
import { DynamoPostRepository } from "../../src/adapters/dynamo/postRepo";
import { samplePost } from "../fixtures";

const ddb = mockClient(DynamoDBDocumentClient);
const repo = new DynamoPostRepository(
  DynamoDBDocumentClient.from(new DynamoDBClient({ region: "ap-northeast-1" })),
  "BlogTable",
);

const cancelled = (...codes: string[]) =>
  new TransactionCanceledException({
    message: "Transaction cancelled",
    $metadata: {},
    CancellationReasons: codes.map((Code) => ({ Code })),
  });

beforeEach(() => ddb.reset());

describe("get", () => {
  it("returns null when the item does not exist", async () => {
    ddb.on(GetCommand).resolves({});
    expect(await repo.get("x")).toBeNull();
  });

  it("strips key attributes from the stored item", async () => {
    const post = samplePost();
    ddb.on(GetCommand).resolves({ Item: toPostItem(post) });
    expect(await repo.get(post.id)).toEqual(post);
    expect(ddb.commandCalls(GetCommand)[0]?.args[0].input.Key).toEqual({
      PK: `POST#${post.id}`,
      SK: "POST",
    });
  });
});

describe("list", () => {
  it("queries the byUpdated index newest first and follows pagination", async () => {
    const a = samplePost({ id: "A", slug: "a" });
    const b = samplePost({ id: "B", slug: "b" });
    ddb
      .on(QueryCommand)
      .resolvesOnce({ Items: [toPostItem(a)], LastEvaluatedKey: { PK: "POST#A" } })
      .resolvesOnce({ Items: [toPostItem(b)] });
    expect((await repo.list()).map((p) => p.id)).toEqual(["A", "B"]);
    const first = ddb.commandCalls(QueryCommand)[0]?.args[0].input;
    expect(first).toMatchObject({ IndexName: "byUpdated", ScanIndexForward: false });
    expect(ddb.commandCalls(QueryCommand)[1]?.args[0].input.ExclusiveStartKey).toEqual({
      PK: "POST#A",
    });
  });
});

describe("create", () => {
  it("writes the post and the slug reservation in one transaction", async () => {
    ddb.on(TransactWriteCommand).resolves({});
    const post = samplePost();
    await repo.create(post);
    const items = ddb.commandCalls(TransactWriteCommand)[0]?.args[0].input.TransactItems;
    expect(items?.[0]?.Put?.ConditionExpression).toBe("attribute_not_exists(PK)");
    expect(items?.[1]?.Put?.Item).toEqual({ PK: "SLUG#hoc-aws", SK: "SLUG", postId: post.id });
    expect(items?.[1]?.Put?.ConditionExpression).toBe("attribute_not_exists(PK)");
  });

  it("maps a slug clash to SLUG_TAKEN", async () => {
    ddb.on(TransactWriteCommand).rejects(cancelled("None", "ConditionalCheckFailed"));
    await expect(repo.create(samplePost())).rejects.toMatchObject({ code: "SLUG_TAKEN" });
  });
});

describe("update", () => {
  it("uses a conditional put on version when the slug is unchanged", async () => {
    ddb.on(PutCommand).resolves({});
    const prev = samplePost({ version: 4 });
    await repo.update({ ...prev, title: "x", version: 5 }, prev);
    const input = ddb.commandCalls(PutCommand)[0]?.args[0].input;
    expect(input?.ConditionExpression).toBe("#v = :v");
    expect(input?.ExpressionAttributeValues).toEqual({ ":v": 4 });
    expect(input?.Item?.GSI1SK).toBe(prev.updatedAt);
  });

  it("maps a failed version condition to VERSION_CONFLICT", async () => {
    ddb
      .on(PutCommand)
      .rejects(new ConditionalCheckFailedException({ message: "failed", $metadata: {} }));
    const prev = samplePost();
    await expect(repo.update({ ...prev, version: 2 }, prev)).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });
  });

  it("moves the slug reservation in a transaction when the slug changes", async () => {
    ddb.on(TransactWriteCommand).resolves({});
    const prev = samplePost();
    await repo.update({ ...prev, slug: "new-slug", version: 2 }, prev);
    const items = ddb.commandCalls(TransactWriteCommand)[0]?.args[0].input.TransactItems;
    expect(items?.[1]?.Put?.Item).toMatchObject({ PK: "SLUG#new-slug" });
    expect(items?.[2]?.Delete?.Key).toEqual({ PK: "SLUG#hoc-aws", SK: "SLUG" });
  });

  it.each([
    [["ConditionalCheckFailed", "None", "None"], "VERSION_CONFLICT"],
    [["None", "ConditionalCheckFailed", "None"], "SLUG_TAKEN"],
  ])("maps cancellation %j to %s", async (codes, code) => {
    ddb.on(TransactWriteCommand).rejects(cancelled(...codes));
    const prev = samplePost();
    await expect(repo.update({ ...prev, slug: "other", version: 2 }, prev)).rejects.toMatchObject({
      code,
    });
  });
});

describe("delete", () => {
  it("deletes the post and its slug reservation together", async () => {
    ddb.on(TransactWriteCommand).resolves({});
    await repo.delete(samplePost());
    const items = ddb.commandCalls(TransactWriteCommand)[0]?.args[0].input.TransactItems;
    expect(items?.map((i) => i.Delete?.Key)).toEqual([
      { PK: "POST#01JABCDEFGHJKMNPQRSTVWXYZ0", SK: "POST" },
      { PK: "SLUG#hoc-aws", SK: "SLUG" },
    ]);
  });
});
