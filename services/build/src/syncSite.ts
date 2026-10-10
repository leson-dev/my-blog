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
/** Content-hashed build assets: safe to cache forever, removed only after invalidation. */
const HASHED_PREFIX = "_astro/";
const UPLOAD_CONCURRENCY = 8;
const DELETE_BATCH = 1000;

export const contentTypeFor = (key: string): string =>
  CONTENT_TYPES[extname(key).toLowerCase()] ?? "application/octet-stream";

export const cacheControlFor = (key: string): string =>
  key.startsWith(HASHED_PREFIX) ? IMMUTABLE : REVALIDATE;

export interface SyncPlan {
  /** Uploaded first: everything that is not HTML. */
  assets: string[];
  /** Uploaded once every asset is in place. */
  pages: string[];
  /** Stale keys removed at the end of the sync (e.g. pages of unpublished posts). */
  deletes: string[];
  /**
   * Stale hashed assets (`_astro/*`). Cached old HTML may still reference them, so they are
   * removed only after the CloudFront invalidation has completed.
   */
  staleAssets: string[];
}

export function planSync(localKeys: string[], remoteKeys: string[]): SyncPlan {
  if (localKeys.length === 0) throw new Error("refusing to sync an empty build output");
  const local = new Set(localKeys);
  const stale = remoteKeys
    .filter((key) => !local.has(key) && !key.startsWith(PROTECTED_PREFIX))
    .sort();
  return {
    assets: localKeys.filter((key) => !key.endsWith(".html")).sort(),
    pages: localKeys.filter((key) => key.endsWith(".html")).sort(),
    deletes: stale.filter((key) => !key.startsWith(HASHED_PREFIX)),
    staleAssets: stale.filter((key) => key.startsWith(HASHED_PREFIX)),
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

/** Deletes keys in batches; fails when S3 reports any key it could not delete. */
export async function deleteKeys(s3: S3Client, bucket: string, keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += DELETE_BATCH) {
    const res = await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: keys.slice(i, i + DELETE_BATCH).map((Key) => ({ Key })), Quiet: true },
      }),
    );
    if (res.Errors?.length) {
      const failed = res.Errors.map((e) => `${e.Key} (${e.Code})`).join(", ");
      throw new Error(`could not delete ${res.Errors.length} key(s): ${failed}`);
    }
  }
}

/**
 * Uploads assets, then pages, then deletes stale pages — HTML never points at a missing asset.
 * Stale hashed assets are returned in `staleAssets` for removal after the invalidation.
 */
export async function syncToS3(s3: S3Client, bucket: string, distDir: string): Promise<SyncPlan> {
  const plan = planSync(listLocalFiles(distDir), await listRemoteKeys(s3, bucket));
  await uploadAll(s3, bucket, distDir, plan.assets);
  await uploadAll(s3, bucket, distDir, plan.pages);
  await deleteKeys(s3, bucket, plan.deletes);
  return plan;
}
