import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Post, Tag } from "@blog/shared";
import { z } from "zod";

const versionSchema = z.object({
  slug: z.string().min(1),
  title: z.string(),
  excerpt: z.string(),
  content: z.string(),
  status: z.enum(["draft", "scheduled", "published"]),
  publishAt: z.string().nullable(),
  publishedAt: z.string().nullable(),
  updatedAt: z.string(),
});

const postSchema = z.object({
  id: z.string().min(1),
  tags: z.array(z.string()),
  coverImage: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number(),
  versions: z.object({ vi: versionSchema.optional(), ja: versionSchema.optional() }),
});

const tagSchema = z.object({
  key: z.string().min(1),
  names: z.object({ vi: z.string().optional(), ja: z.string().optional() }),
});

export interface SiteData {
  posts: Post[];
  tags: Tag[];
}

export function dataDir(env: Record<string, string | undefined> = process.env): string {
  return env.BLOG_DATA_DIR ?? resolve(process.cwd(), "fixtures");
}

function readJson<T>(dir: string, file: string, schema: z.ZodType<T>): T {
  try {
    return schema.parse(JSON.parse(readFileSync(join(dir, file), "utf8")));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`invalid site data in ${join(dir, file)}: ${reason}`);
  }
}

export function loadSiteData(dir: string = dataDir()): SiteData {
  return {
    posts: readJson(dir, "posts.json", z.array(postSchema)),
    tags: readJson(dir, "tags.json", z.array(tagSchema)),
  };
}

let cached: SiteData | undefined;

/** Loads the data once per build. */
export function siteData(): SiteData {
  cached ??= loadSiteData();
  return cached;
}
