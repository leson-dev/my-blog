import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { fromPostItem, fromTagItem, queryIndex } from "@blog/api/dynamo";

/** Writes posts.json (all posts, drafts included — the site filters) and tags.json into `dir`. */
export async function exportSiteData(
  db: DynamoDBDocumentClient,
  tableName: string,
  dir: string,
): Promise<{ posts: number; tags: number }> {
  const [postItems, tagItems] = await Promise.all([
    queryIndex(db, tableName, "POST", true),
    queryIndex(db, tableName, "TAG", false),
  ]);
  const posts = postItems.map(fromPostItem);
  const tags = tagItems.map(fromTagItem);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "posts.json"), JSON.stringify(posts));
  writeFileSync(join(dir, "tags.json"), JSON.stringify(tags));
  return { posts: posts.length, tags: tags.length };
}
