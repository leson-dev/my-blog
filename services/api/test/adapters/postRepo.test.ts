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
import { samplePost, sampleVersion } from "../fixtures";

const ddb = mockClient(DynamoDBDocumentClient);
const repo = new DynamoPostRepository(
  DynamoDBDocumentClient.from(new DynamoDBClient({ region: "ap-northeast-1" })),
  "BlogTable",
);
const ID = "01JABCDEFGHJKMNPQRSTVWXYZ0";

const cancelled = (...codes: string[]) =>
  new TransactionCanceledException({
    message: "Transaction cancelled",
    $metadata: {},
    CancellationReasons: codes.map((Code) => ({ Code })),
  });
const transactItems = () =>
  ddb.commandCalls(TransactWriteCommand)[0]?.args[0].input.TransactItems ?? [];
const bilingual = (version = 1) =>
  samplePost({
    version,
    versions: { vi: sampleVersion(), ja: sampleVersion({ slug: "aws-ja", title: "AWS" }) },
  });

beforeEach(() => ddb.reset());

describe("get / list", () => {
  it("returns null for a missing item and strips key attributes", async () => {
    ddb
      .on(GetCommand)
      .resolvesOnce({})
      .resolvesOnce({ Item: toPostItem(samplePost()) });
    expect(await repo.get("x")).toBeNull();
    expect(await repo.get(ID)).toEqual(samplePost());
  });

  it("queries the byUpdated index for POST newest first and follows pagination", async () => {
    ddb
      .on(QueryCommand)
      .resolvesOnce({
        Items: [toPostItem(samplePost({ id: "A" }))],
        LastEvaluatedKey: { PK: "POST#A" },
      })
      .resolvesOnce({ Items: [toPostItem(samplePost({ id: "B" }))] });
    expect((await repo.list()).map((p) => p.id)).toEqual(["A", "B"]);
    const first = ddb.commandCalls(QueryCommand)[0]?.args[0].input;
    expect(first).toMatchObject({
      IndexName: "byUpdated",
      ScanIndexForward: false,
      ExpressionAttributeValues: { ":pk": "POST" },
    });
  });
});

describe("create", () => {
  it("reserves every slug with its language in the same transaction", async () => {
    ddb.on(TransactWriteCommand).resolves({});
    await repo.create(bilingual());
    const items = transactItems();
    expect(items).toHaveLength(3);
    expect(items[1]?.Put?.Item).toEqual({ PK: "SLUG#hoc-aws", SK: "SLUG", postId: ID, lang: "vi" });
    expect(items[2]?.Put?.Item).toEqual({ PK: "SLUG#aws-ja", SK: "SLUG", postId: ID, lang: "ja" });
    expect(items[2]?.Put?.ConditionExpression).toBe("attribute_not_exists(PK)");
  });

  it("names the clashing slug in SLUG_TAKEN", async () => {
    ddb.on(TransactWriteCommand).rejects(cancelled("None", "None", "ConditionalCheckFailed"));
    await expect(repo.create(bilingual())).rejects.toMatchObject({
      code: "SLUG_TAKEN",
      message: expect.stringContaining("aws-ja"),
    });
  });
});

describe("update", () => {
  it("uses a conditional put when no slug changes", async () => {
    ddb.on(PutCommand).resolves({});
    const prev = samplePost({ version: 4 });
    await repo.update({ ...prev, tags: ["x"], version: 5 }, prev);
    const input = ddb.commandCalls(PutCommand)[0]?.args[0].input;
    expect(input?.ConditionExpression).toBe("#v = :v");
    expect(input?.ExpressionAttributeValues).toEqual({ ":v": 4 });
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

  it("reserves the slug of an added language", async () => {
    ddb.on(TransactWriteCommand).resolves({});
    await repo.update(bilingual(2), samplePost());
    const items = transactItems();
    expect(items).toHaveLength(2);
    expect(items[1]?.Put?.Item).toEqual({ PK: "SLUG#aws-ja", SK: "SLUG", postId: ID, lang: "ja" });
  });

  it("moves the reservation when one language changes slug", async () => {
    ddb.on(TransactWriteCommand).resolves({});
    const prev = bilingual(1);
    const next = {
      ...prev,
      version: 2,
      versions: { ...prev.versions, vi: sampleVersion({ slug: "moi" }) },
    };
    await repo.update(next, prev);
    const items = transactItems();
    expect(items[1]?.Put?.Item).toMatchObject({ PK: "SLUG#moi", lang: "vi" });
    expect(items[2]?.Delete?.Key).toEqual({ PK: "SLUG#hoc-aws", SK: "SLUG" });
  });

  it("releases the slug of a removed language", async () => {
    ddb.on(TransactWriteCommand).resolves({});
    await repo.update(samplePost({ version: 2 }), bilingual(1));
    const items = transactItems();
    expect(items).toHaveLength(2);
    expect(items[1]?.Delete?.Key).toEqual({ PK: "SLUG#aws-ja", SK: "SLUG" });
  });

  it.each([
    [["ConditionalCheckFailed", "None"], "VERSION_CONFLICT"],
    [["None", "ConditionalCheckFailed"], "SLUG_TAKEN"],
  ])("maps cancellation %j to %s", async (codes, code) => {
    ddb.on(TransactWriteCommand).rejects(cancelled(...codes));
    await expect(repo.update(bilingual(2), samplePost())).rejects.toMatchObject({ code });
  });
});

describe("delete", () => {
  it("deletes the post and every slug reservation", async () => {
    ddb.on(TransactWriteCommand).resolves({});
    await repo.delete(bilingual());
    expect(transactItems().map((i) => i.Delete?.Key)).toEqual([
      { PK: `POST#${ID}`, SK: "POST" },
      { PK: "SLUG#hoc-aws", SK: "SLUG" },
      { PK: "SLUG#aws-ja", SK: "SLUG" },
    ]);
  });
});
