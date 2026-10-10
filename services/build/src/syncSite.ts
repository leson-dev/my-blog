import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";

export const IMMUTABLE = "public, max-age=31536000, immutable";
export const REVALIDATE = "public, max-age=0, must-revalidate";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

/** Keys owned by the media bucket; never deleted from the site bucket. */
const PROTECTED_PREFIX = "media/";
const UPLOAD_CONCURRENCY = 8;
const DELETE_BATCH = 1000;

export const contentTypeFor = (key: string): string =>
  CONTENT_TYPES[extname(key).toLowerCase()] ?? "application/octet-stream";

export const cacheControlFor = (key: string): string =>
  key.startsWith("_astro/") ? IMMUTABLE : REVALIDATE;

export interface SyncPlan {
  /** Uploaded first: everything that is not HTML. */
  assets: string[];
  /** Uploaded once every asset is in place. */
  pages: string[];
  /** Removed last. */
  deletes: string[];
}

export function planSync(localKeys: string[], remoteKeys: string[]): SyncPlan {
  if (localKeys.length === 0) throw new Error("refusing to sync an empty build output");
  const local = new Set(localKeys);
  return {
    assets: localKeys.filter((key) => !key.endsWith(".html")).sort(),
    pages: localKeys.filter((key) => key.endsWith(".html")).sort(),
    deletes: remoteKeys
      .filter((key) => !local.has(key) && !key.startsWith(PROTECTED_PREFIX))
      .sort(),
  };
}

export function listLocalFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/"));
}

async function listRemoteKeys(s3: S3Client, bucket: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
    );
    for (const object of res.Contents ?? []) if (object.Key) keys.push(object.Key);
    token = res.NextContinuationToken;
  } while (token);
  return keys;
}

async function uploadAll(s3: S3Client, bucket: string, distDir: string, keys: string[]) {
  let next = 0;
  const worker = async () => {
    while (next < keys.length) {
      const key = keys[next++] as string;
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: readFileSync(join(distDir, key)),
          ContentType: contentTypeFor(key),
          CacheControl: cacheControlFor(key),
        }),
      );
    }
  };
  await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker));
}

/** Uploads assets, then pages, then deletes stale keys — HTML never points at a missing asset. */
export async function syncToS3(s3: S3Client, bucket: string, distDir: string): Promise<SyncPlan> {
  const plan = planSync(listLocalFiles(distDir), await listRemoteKeys(s3, bucket));
  await uploadAll(s3, bucket, distDir, plan.assets);
  await uploadAll(s3, bucket, distDir, plan.pages);
  for (let i = 0; i < plan.deletes.length; i += DELETE_BATCH) {
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: plan.deletes.slice(i, i + DELETE_BATCH).map((Key) => ({ Key })),
          Quiet: true,
        },
      }),
    );
  }
  return plan;
}
