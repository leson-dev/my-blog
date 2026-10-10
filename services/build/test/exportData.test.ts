import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { exportSiteData } from "../src/exportData";

const ddb = mockClient(DynamoDBDocumentClient);
const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "ap-northeast-1" }));

const postItem = (id: string) => ({
  PK: `POST#${id}`,
  SK: "POST",
  GSI1PK: "POST",
  GSI1SK: "2026-10-10T00:00:00.000Z",
  id,
  tags: [],
  coverImage: null,
  createdAt: "2026-10-10T00:00:00.000Z",
  updatedAt: "2026-10-10T00:00:00.000Z",
  version: 1,
  versions: {},
});

beforeEach(() => ddb.reset());

describe("exportSiteData", () => {
  it("writes every post and tag without key attributes", async () => {
    ddb
      .on(QueryCommand, { ExpressionAttributeValues: { ":pk": "POST" } })
      .resolvesOnce({ Items: [postItem("A")], LastEvaluatedKey: { PK: "POST#A" } })
      .resolvesOnce({ Items: [postItem("B")] });
    ddb.on(QueryCommand, { ExpressionAttributeValues: { ":pk": "TAG" } }).resolves({
      Items: [
        {
          PK: "TAG#life",
          SK: "TAG",
          GSI1PK: "TAG",
          GSI1SK: "life",
          key: "life",
          names: { ja: "暮らし" },
        },
      ],
    });

    const dir = join(mkdtempSync(join(tmpdir(), "export-")), "data");
    const counts = await exportSiteData(db, "BlogTable", dir);

    expect(counts).toEqual({ posts: 2, tags: 1 });
    const posts = JSON.parse(readFileSync(join(dir, "posts.json"), "utf8"));
    expect(posts.map((p: { id: string }) => p.id)).toEqual(["A", "B"]);
    expect(posts[0]).not.toHaveProperty("PK");
    expect(JSON.parse(readFileSync(join(dir, "tags.json"), "utf8"))).toEqual([
      { key: "life", names: { ja: "暮らし" } },
    ]);
  });
});
