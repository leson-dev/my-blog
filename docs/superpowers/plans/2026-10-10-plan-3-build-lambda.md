# Kế hoạch 3: Lambda Build — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng `services/build` — Lambda (container image, x86_64) nhận message từ SQS FIFO, xuất dữ liệu DynamoDB ra JSON, chạy `astro build` + Pagefind, đồng bộ lên S3 theo thứ tự an toàn, invalidate CloudFront và ghi trạng thái build. Kiểm thử bằng mock + một bản build thật trên máy + chạy thử image với filesystem chỉ-đọc. Chưa deploy.

**Architecture:** Image chứa monorepo đã cài thư viện tại `/opt/blog` (chỉ đọc). Lần đầu container chạy, `prepareWorkspace` chép mã nguồn sang `/tmp/blog`, còn mọi thư mục `node_modules` thành **symlink** về `/opt/blog` (tránh chép 400+ MB). Astro/Vite ghi cache vào `apps/site/.cache/` (trong `/tmp`). Mỗi lượt build: `status=running` → `exportSiteData` ghi `posts.json`/`tags.json` vào thư mục dữ liệu riêng → `runSiteBuild` (bắt buộc có dữ liệu, truyền `BLOG_DATA_DIR`) → `syncToS3` (asset → HTML → xoá file thừa, có rào chắn) → invalidate `/*` → `status=success`. Lỗi → `status=failed` + ném lỗi để SQS thử lại.

**Tech Stack:** Node.js 24, TypeScript 7.0.2, AWS SDK v3 3.1146.0 (DynamoDB, S3, CloudFront), Powertools Logger 2.36.0, esbuild 0.28.2, Vitest 5.0.3, Docker (`node:24-bookworm-slim` để cài, `public.ecr.aws/lambda/nodejs:24` để chạy).

**Spec:**
- [`docs/superpowers/specs/2026-10-10-serverless-blog-design.md`](../specs/2026-10-10-serverless-blog-design.md) — mục 3.3 (Lambda Build), 3.4 (một build một lúc, gộp build), 3.5 (build lỗi), 4.1 (cache).
- [`docs/superpowers/specs/2026-10-10-ui-i18n-design.md`](../specs/2026-10-10-ui-i18n-design.md) — mục 3.6 (Lambda Build đọc bài + tag).

**Vị trí:** sau Kế hoạch 2 (đã merge). Kế hoạch 4 (CDK) dùng image này, biến môi trường ở Task 4 và hàng đợi SQS FIFO + DLQ.

## Global Constraints

- Ràng buộc chung của các kế hoạch trước vẫn áp dụng (pnpm catalog, không `minimumReleaseAgeExclude`, TS strict, Biome, commit trailer).
- Thêm vào catalog: `"@aws-sdk/client-cloudfront": 3.1146.0`, `esbuild: 0.28.2`.
- **Không bao giờ build bằng dữ liệu mẫu ở production:** `runSiteBuild` nhận `dataDir` bắt buộc, kiểm tra `posts.json` và `tags.json` tồn tại **trước** khi chạy Astro, và luôn đặt `BLOG_DATA_DIR`.
- **Chỉ ghi vào `/tmp`:** mọi thứ Astro/Vite/Pagefind/Lambda ghi ra phải nằm dưới `WORK_DIR` (mặc định `/tmp/blog`), `DATA_DIR` (mặc định `/tmp/site-data`) hoặc `HOME=/tmp`. Được kiểm chứng bằng `docker run --read-only --tmpfs /tmp`.
- **Đồng bộ S3** (spec 3.3): upload mọi file **không phải** `.html` trước → upload `.html` → xoá key không còn trong bản build. Rào chắn: (1) bản build rỗng → ném lỗi, không xoá gì; (2) không bao giờ xoá key bắt đầu bằng `media/`.
- **Cache-Control:** `_astro/*` → `public, max-age=31536000, immutable`; mọi file khác → `public, max-age=0, must-revalidate`.
- **Trạng thái build** ghi vào item `BUILD`/`LATEST` (`status`: `running` | `success` | `failed`, `updatedAt`, `error`); `error` cắt tối đa 1.000 ký tự.
- **Lỗi:** ghi `failed` rồi **ném lại** để SQS thử lại (`maxReceiveCount = 2`, DLQ cấu hình ở Kế hoạch 4). Không đồng bộ S3 nếu `astro build` hoặc Pagefind lỗi.
- Một lần gọi Lambda có thể nhận tới 10 message (cùng `MessageGroupId = "site"`) → **chỉ build một lần**.
- Lambda: container image **x86_64**, 2048 MB, timeout 5 phút, `/tmp` 2 GB (Kế hoạch 4 khai báo).

## Review Focus

1. **Lambda chạy thiếu dữ liệu hoặc thiếu `BLOG_DATA_DIR`** → phải dừng với lỗi rõ ràng, tuyệt đối không build bằng `apps/site/fixtures`. → Task 3, Task 4.
2. **`SITE_BUCKET` cấu hình nhầm sang bucket ảnh, hoặc bản build ra rỗng** → không được xoá ảnh / xoá sạch site. → Task 2.
3. **Người đọc gặp trang trỏ tới asset chưa tồn tại giữa lúc đồng bộ** → mọi asset phải lên S3 trước HTML đầu tiên; xoá chỉ sau cùng. → Task 2.
4. **Build lỗi giữa chừng** → trạng thái `failed` có thông báo đọc được (stderr của Astro), site cũ giữ nguyên (không gọi sync/invalidate), lỗi được ném lại. → Task 4.
5. **Filesystem chỉ-đọc của Lambda** → không gì ghi ra ngoài `/tmp` (cache Vite/Astro, `.astro/`, HOME, telemetry). → Task 3 (cấu hình), Task 5 (chạy image với `--read-only`).

---

## Cấu trúc file

```
pnpm-workspace.yaml                  # SỬA: catalog
.gitignore                           # SỬA: thêm .cache/
.dockerignore                        # MỚI
apps/site/astro.config.mjs           # SỬA: cacheDir + vite.cacheDir trong ./.cache
services/api/package.json            # SỬA: export "./dynamo"
services/api/src/adapters/dynamo/public.ts   # MỚI: re-export cho services/build
services/build/
  package.json, tsconfig.json, vitest.config.ts
  scripts/bundle.mjs                 # esbuild → dist/index.mjs, dist/smoke.mjs
  Dockerfile
  src/exportData.ts                  # DynamoDB → posts.json, tags.json
  src/syncSite.ts                    # kế hoạch đồng bộ + upload/xoá S3
  src/siteBuild.ts                   # prepareWorkspace, runSiteBuild
  src/invalidate.ts                  # CloudFront /*
  src/status.ts                      # BUILD/LATEST running|success|failed
  src/runBuild.ts                    # điều phối một lượt build
  src/config.ts, src/deps.ts, src/index.ts   # env, ghép adapter, handler SQS
  src/smoke.ts                       # chạy thử trong image
  test/exportData.test.ts, syncSite.test.ts, siteBuild.test.ts, runBuild.test.ts, config.test.ts
```

---

### Task 1: Khung `services/build` & xuất dữ liệu DynamoDB

**Files:**
- Modify: `pnpm-workspace.yaml`, `services/api/package.json`
- Create: `services/api/src/adapters/dynamo/public.ts`
- Create: `services/build/package.json`, `services/build/tsconfig.json`, `services/build/vitest.config.ts`, `services/build/src/exportData.ts`
- Test: `services/build/test/exportData.test.ts`

**Interfaces:**
- Consumes: `queryIndex`, `fromPostItem`, `fromTagItem`, `BUILD_KEY` (Kế hoạch 1b, `services/api/src/adapters/dynamo`).
- Produces:
  - `@blog/api/dynamo` (export mới): `BUILD_KEY`, `POSTS_INDEX`, `fromPostItem`, `fromTagItem`, `queryIndex`
  - `exportSiteData(db: DynamoDBDocumentClient, tableName: string, dir: string): Promise<{ posts: number; tags: number }>` — ghi `dir/posts.json` (mọi bài, kể cả nháp — site tự lọc) và `dir/tags.json`

- [ ] **Step 1: Tạo nhánh & catalog**

```bash
git checkout -b feat/plan-3-build
```

Thêm vào cuối khối `catalog:` của `pnpm-workspace.yaml`:
```yaml
  "@aws-sdk/client-cloudfront": 3.1146.0
  esbuild: 0.28.2
```

- [ ] **Step 2: Export helper DynamoDB của API**

`services/api/src/adapters/dynamo/public.ts`:
```ts
// Read-side helpers shared with services/build. Keep the key layout in one place.
export { BUILD_KEY, fromPostItem, fromTagItem, POSTS_INDEX } from "./items";
export { queryIndex } from "./queryIndex";
```

Trong `services/api/package.json`, thêm ngay sau dòng `"type": "module",`:
```json
  "exports": { "./dynamo": "./src/adapters/dynamo/public.ts" },
```

- [ ] **Step 3: Khung package**

`services/build/package.json`:
```json
{
  "name": "@blog/build",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run",
    "bundle": "node scripts/bundle.mjs"
  },
  "dependencies": {
    "@aws-lambda-powertools/logger": "catalog:",
    "@aws-sdk/client-cloudfront": "catalog:",
    "@aws-sdk/client-dynamodb": "catalog:",
    "@aws-sdk/client-s3": "catalog:",
    "@aws-sdk/lib-dynamodb": "catalog:",
    "@blog/api": "workspace:*",
    "@blog/shared": "workspace:*",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@types/aws-lambda": "catalog:",
    "@types/node": "catalog:",
    "aws-sdk-client-mock": "catalog:",
    "esbuild": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

`services/build/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

`services/build/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
```

Run: `pnpm install`
Expected: thành công, không cảnh báo `minimumReleaseAge`.

- [ ] **Step 4: Viết test thất bại**

`services/build/test/exportData.test.ts`:
```ts
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
      Items: [{ PK: "TAG#life", SK: "TAG", GSI1PK: "TAG", GSI1SK: "life", key: "life", names: { ja: "暮らし" } }],
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
```

- [ ] **Step 5: Chạy test để thấy thất bại**

Run: `pnpm --filter @blog/build test`
Expected: FAIL — `Cannot find module '../src/exportData'`.

- [ ] **Step 6: Viết mã**

`services/build/src/exportData.ts`:
```ts
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
```

- [ ] **Step 7: Chạy test để thấy thành công**

Run: `pnpm --filter @blog/build test && pnpm --filter @blog/build typecheck && pnpm --filter @blog/api test`
Expected: PASS; typecheck sạch; test API không bị ảnh hưởng.

- [ ] **Step 8: Commit**

```bash
pnpm format
git add pnpm-workspace.yaml pnpm-lock.yaml services/api/package.json services/api/src/adapters/dynamo/public.ts services/build
git commit -m "feat(build): export posts and tags from DynamoDB to site JSON" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Đồng bộ S3 an toàn

**Files:**
- Create: `services/build/src/syncSite.ts`
- Test: `services/build/test/syncSite.test.ts`

**Interfaces:**
- Produces:
  - `IMMUTABLE = "public, max-age=31536000, immutable"`, `REVALIDATE = "public, max-age=0, must-revalidate"`
  - `contentTypeFor(key: string): string`, `cacheControlFor(key: string): string`
  - `interface SyncPlan { assets: string[]; pages: string[]; deletes: string[] }`
  - `planSync(localKeys: string[], remoteKeys: string[]): SyncPlan` — ném lỗi nếu `localKeys` rỗng; không đưa key `media/…` vào `deletes`
  - `listLocalFiles(dir: string): string[]` — key dạng POSIX tương đối
  - `syncToS3(s3: S3Client, bucket: string, distDir: string): Promise<SyncPlan>`

- [ ] **Step 1: Viết test thất bại**

`services/build/test/syncSite.test.ts`:
```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import {
  cacheControlFor,
  contentTypeFor,
  IMMUTABLE,
  listLocalFiles,
  planSync,
  REVALIDATE,
  syncToS3,
} from "../src/syncSite";

const s3mock = mockClient(S3Client);
const s3 = new S3Client({ region: "ap-northeast-1" });

const makeDist = () => {
  const dir = mkdtempSync(join(tmpdir(), "dist-"));
  for (const [path, body] of Object.entries({
    "index.html": "<html></html>",
    "vi/index.html": "<html></html>",
    "_astro/app.abc123.css": "body{}",
    "pagefind/pagefind.js": "x",
  })) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
};

beforeEach(() => s3mock.reset());

describe("headers", () => {
  it("picks content types by extension", () => {
    expect(contentTypeFor("vi/index.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeFor("_astro/a.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeFor("pagefind/pagefind.js")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeFor("_astro/font.woff2")).toBe("font/woff2");
    expect(contentTypeFor("pagefind/index/en_1.pf_index")).toBe("application/octet-stream");
  });

  it("caches hashed assets forever and revalidates everything else", () => {
    expect(cacheControlFor("_astro/app.abc123.css")).toBe(IMMUTABLE);
    expect(cacheControlFor("vi/index.html")).toBe(REVALIDATE);
    expect(cacheControlFor("pagefind/pagefind.js")).toBe(REVALIDATE);
  });
});

describe("planSync", () => {
  it("splits assets from pages and deletes keys that disappeared", () => {
    const plan = planSync(
      ["vi/index.html", "_astro/b.css", "index.html", "pagefind/x.js"],
      ["index.html", "vi/posts/old/index.html", "_astro/old.css"],
    );
    expect(plan).toEqual({
      assets: ["_astro/b.css", "pagefind/x.js"],
      pages: ["index.html", "vi/index.html"],
      deletes: ["_astro/old.css", "vi/posts/old/index.html"],
    });
  });

  it("refuses to sync an empty build", () => {
    expect(() => planSync([], ["index.html"])).toThrow(/empty/);
  });

  it("never deletes media keys", () => {
    expect(planSync(["index.html"], ["media/2026/a.webp", "old.html"]).deletes).toEqual(["old.html"]);
  });
});

describe("listLocalFiles", () => {
  it("lists files as POSIX keys relative to the dist dir", () => {
    expect(listLocalFiles(makeDist()).sort()).toEqual([
      "_astro/app.abc123.css",
      "index.html",
      "pagefind/pagefind.js",
      "vi/index.html",
    ]);
  });
});

describe("syncToS3", () => {
  it("uploads all assets before any page and deletes last", async () => {
    s3mock
      .on(ListObjectsV2Command)
      .resolvesOnce({ Contents: [{ Key: "gone.html" }], NextContinuationToken: "t" })
      .resolvesOnce({ Contents: [{ Key: "media/2026/a.webp" }] });
    s3mock.on(PutObjectCommand).resolves({});
    s3mock.on(DeleteObjectsCommand).resolves({});

    const plan = await syncToS3(s3, "site-bucket", makeDist());

    const calls = s3mock.calls().map((c) => c.args[0]);
    const order = calls
      .filter((cmd) => !(cmd instanceof ListObjectsV2Command))
      .map((cmd) => {
        if (cmd instanceof PutObjectCommand) return cmd.input.Key;
        const input = cmd.input as { Delete?: { Objects?: Array<{ Key?: string }> } };
        return `DELETE ${input.Delete?.Objects?.map((o) => o.Key).join(",")}`;
      });
    const firstPage = order.findIndex((k) => String(k).endsWith(".html"));
    const lastAsset = order.findLastIndex((k) => !String(k).endsWith(".html") && !String(k).startsWith("DELETE"));
    expect(lastAsset).toBeLessThan(firstPage);
    expect(order.at(-1)).toBe("DELETE gone.html");
    expect(plan.deletes).toEqual(["gone.html"]);

    const css = s3mock.commandCalls(PutObjectCommand).find((c) => c.args[0].input.Key === "_astro/app.abc123.css");
    expect(css?.args[0].input).toMatchObject({
      Bucket: "site-bucket",
      ContentType: "text/css; charset=utf-8",
      CacheControl: IMMUTABLE,
    });
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `pnpm --filter @blog/build exec vitest run test/syncSite.test.ts`
Expected: FAIL — `Cannot find module '../src/syncSite'`.

- [ ] **Step 3: Viết mã**

`services/build/src/syncSite.ts`:
```ts
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
    const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
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
```

- [ ] **Step 4: Chạy test để thấy thành công**

Run: `pnpm --filter @blog/build test && pnpm --filter @blog/build typecheck`
Expected: PASS; typecheck sạch.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add services/build
git commit -m "feat(build): safe ordered S3 sync of the built site" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Không gian làm việc ghi được & chạy build site

**Files:**
- Modify: `apps/site/astro.config.mjs`, `.gitignore`
- Create: `services/build/src/siteBuild.ts`
- Test: `services/build/test/siteBuild.test.ts`

**Interfaces:**
- Produces:
  - `prepareWorkspace(sourceDir: string, workDir: string): void` — idempotent (file đánh dấu `.prepared`); chép cây mã nguồn trừ `node_modules`, `dist`, `.astro`, `.cache`, `.git`, `.superpowers`; tạo symlink cho `node_modules` ở gốc và ở mọi `apps/*`, `packages/*`, `services/*`
  - `runSiteBuild(opts: { workDir: string; dataDir: string }): Promise<string>` — trả `distDir`; ném lỗi `site data missing: <path>` nếu thiếu `posts.json`/`tags.json`

- [ ] **Step 1: Đưa cache Astro/Vite vào thư mục project**

`apps/site/astro.config.mjs` (thay toàn bộ):
```js
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://blog.oki-dev.xyz",
  output: "static",
  trailingSlash: "always",
  build: { format: "directory" },
  compressHTML: true,
  prefetch: { prefetchAll: true, defaultStrategy: "hover" },
  // Keep caches inside the project (not node_modules): node_modules is read-only in the
  // Build Lambda, where the project itself lives in /tmp.
  cacheDir: "./.cache/astro",
  vite: { cacheDir: "./.cache/vite" },
});
```

Thêm vào `.gitignore` ngay dưới dòng `.astro/`:
```
.cache/
```

Run: `pnpm --filter @blog/site test`
Expected: PASS (31 test) — site vẫn build như cũ.

- [ ] **Step 2: Viết test thất bại**

`services/build/test/siteBuild.test.ts`:
```ts
import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareWorkspace, runSiteBuild } from "../src/siteBuild";

const repoRoot = resolve(__dirname, "../../..");

describe("runSiteBuild", () => {
  it("refuses to build without exported site data", async () => {
    const empty = mkdtempSync(join(tmpdir(), "no-data-"));
    await expect(runSiteBuild({ workDir: repoRoot, dataDir: empty })).rejects.toThrow(
      /site data missing: .*posts\.json/,
    );
  });
});

describe("prepareWorkspace + runSiteBuild", () => {
  it("builds the site in a work dir whose node_modules are symlinks to the source", async () => {
    const workDir = join(mkdtempSync(join(tmpdir(), "work-")), "blog");
    prepareWorkspace(repoRoot, workDir);
    prepareWorkspace(repoRoot, workDir); // idempotent

    expect(lstatSync(join(workDir, "node_modules")).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(workDir, "apps/site/node_modules")).isSymbolicLink()).toBe(true);
    expect(existsSync(join(workDir, "apps/site/dist"))).toBe(false);

    const dataDir = mkdtempSync(join(tmpdir(), "data-"));
    cpSync(join(repoRoot, "apps/site/fixtures"), dataDir, { recursive: true });

    const distDir = await runSiteBuild({ workDir, dataDir });

    expect(distDir).toBe(join(workDir, "apps/site/dist"));
    expect(readFileSync(join(distDir, "index.html"), "utf8")).toContain("Học AWS Lambda từ con số 0");
    expect(existsSync(join(distDir, "pagefind/pagefind.js"))).toBe(true);
    // Astro wrote its generated types into the writable copy, not into the source tree.
    expect(existsSync(join(workDir, "apps/site/.astro"))).toBe(true);
  });
});
```

- [ ] **Step 3: Chạy test để thấy thất bại**

Run: `pnpm --filter @blog/build exec vitest run test/siteBuild.test.ts`
Expected: FAIL — `Cannot find module '../src/siteBuild'`.

- [ ] **Step 4: Viết mã**

`services/build/src/siteBuild.ts`:
```ts
import { execFile } from "node:child_process";
import {
  cpSync,
  existsSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const SKIPPED = new Set(["node_modules", "dist", ".astro", ".cache", ".git", ".superpowers"]);
const PACKAGE_GROUPS = ["apps", "packages", "services"];
const MAX_OUTPUT = 64 * 1024 * 1024;

/**
 * Mirrors the (read-only) source tree into a writable work dir. Sources are copied; every
 * node_modules folder becomes a symlink back to the source, so 400+ MB are never copied.
 */
export function prepareWorkspace(sourceDir: string, workDir: string): void {
  const marker = join(workDir, ".prepared");
  if (existsSync(marker)) return;
  rmSync(workDir, { recursive: true, force: true });
  cpSync(sourceDir, workDir, {
    recursive: true,
    filter: (src) => !relative(sourceDir, src).split(sep).some((part) => SKIPPED.has(part)),
  });

  const link = (pkg: string) => {
    const from = join(sourceDir, pkg, "node_modules");
    if (existsSync(from)) symlinkSync(from, join(workDir, pkg, "node_modules"), "dir");
  };
  link(".");
  for (const group of PACKAGE_GROUPS) {
    const dir = join(sourceDir, group);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) link(join(group, name));
  }
  writeFileSync(marker, "");
}

/** Runs `astro build` and Pagefind for apps/site with the given data dir; returns the dist dir. */
export async function runSiteBuild(opts: { workDir: string; dataDir: string }): Promise<string> {
  for (const file of ["posts.json", "tags.json"]) {
    const path = join(opts.dataDir, file);
    if (!existsSync(path)) throw new Error(`site data missing: ${path}`);
  }
  const siteDir = join(opts.workDir, "apps/site");
  const distDir = join(siteDir, "dist");
  rmSync(distDir, { recursive: true, force: true });

  const env = {
    ...process.env,
    BLOG_DATA_DIR: opts.dataDir,
    ASTRO_TELEMETRY_DISABLED: "1",
    HOME: tmpdir(),
  };
  const options = { cwd: siteDir, env, maxBuffer: MAX_OUTPUT };
  await run(process.execPath, [join(siteDir, "node_modules/astro/bin/astro.mjs"), "build"], options);
  await run(
    process.execPath,
    [join(siteDir, "node_modules/pagefind/lib/runner/bin.cjs"), "--site", "dist"],
    options,
  );
  return distDir;
}
```

- [ ] **Step 5: Chạy test để thấy thành công**

Run: `pnpm --filter @blog/build test && pnpm --filter @blog/build typecheck`
Expected: PASS (bản build thật mất khoảng 5–20 giây); typecheck sạch.

- [ ] **Step 6: Commit**

```bash
pnpm format
git add .gitignore apps/site/astro.config.mjs services/build
git commit -m "feat(build): writable workspace with symlinked node_modules and guarded site build" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Trạng thái, invalidate, điều phối & handler SQS

**Files:**
- Create: `services/build/src/status.ts`, `services/build/src/invalidate.ts`, `services/build/src/runBuild.ts`, `services/build/src/config.ts`, `services/build/src/deps.ts`, `services/build/src/index.ts`
- Test: `services/build/test/runBuild.test.ts`, `services/build/test/config.test.ts`

**Interfaces:**
- Consumes: Task 1–3.
- Produces:
  - `type BuildPhase = "running" | "success" | "failed"`; `class DynamoBuildStatus { constructor(db, tableName); set(status: BuildPhase, now: string, error?: string | null): Promise<void> }`
  - `invalidateAll(cf: CloudFrontClient, distributionId: string, callerReference: string): Promise<void>`
  - `interface BuildDeps { now; status: { set }; prepare(): void; exportData(dir): Promise<{posts; tags}>; buildSite(dataDir): Promise<string>; sync(distDir): Promise<SyncPlan>; invalidate(reference): Promise<void>; log: { info; error }; dataDir: string }`
  - `runBuild(deps: BuildDeps, reference: string): Promise<void>`
  - `loadConfig(env)`: `TABLE_NAME`, `SITE_BUCKET`, `DISTRIBUTION_ID` (bắt buộc); `SOURCE_DIR` (mặc định `/opt/blog`), `WORK_DIR` (`/tmp/blog`), `DATA_DIR` (`/tmp/site-data`)
  - Entry Lambda: `services/build/src/index.ts` export `handler(event: SQSEvent)`

- [ ] **Step 1: Viết test thất bại**

`services/build/test/runBuild.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { type BuildDeps, runBuild } from "../src/runBuild";

const makeDeps = (overrides: Partial<BuildDeps> = {}) => {
  const events: string[] = [];
  const statuses: Array<{ status: string; error: string | null | undefined }> = [];
  const deps: BuildDeps = {
    now: () => "2026-10-10T00:00:00.000Z",
    status: {
      set: async (status, _now, error) => {
        statuses.push({ status, error });
        events.push(`status:${status}`);
      },
    },
    prepare: () => events.push("prepare"),
    exportData: async () => {
      events.push("export");
      return { posts: 5, tags: 1 };
    },
    buildSite: async (dataDir) => {
      events.push(`build:${dataDir}`);
      return "/tmp/blog/apps/site/dist";
    },
    sync: async () => {
      events.push("sync");
      return { assets: ["a.css"], pages: ["index.html"], deletes: [] };
    },
    invalidate: async (reference) => {
      events.push(`invalidate:${reference}`);
    },
    log: { info: vi.fn(), error: vi.fn() },
    dataDir: "/tmp/site-data",
    ...overrides,
  };
  return { deps, events, statuses };
};

describe("runBuild", () => {
  it("runs every step in order and reports success", async () => {
    const { deps, events } = makeDeps();
    await runBuild(deps, "msg-1");
    expect(events).toEqual([
      "status:running",
      "prepare",
      "export",
      "build:/tmp/site-data",
      "sync",
      "invalidate:msg-1",
      "status:success",
    ]);
  });

  it("records the failure, keeps the old site and rethrows when the site build fails", async () => {
    const { deps, events, statuses } = makeDeps({
      buildSite: async () => {
        throw new Error("Command failed: astro build\n[ERROR] invalid site data in /tmp/site-data/posts.json");
      },
    });
    await expect(runBuild(deps, "msg-1")).rejects.toThrow("Command failed");
    expect(events).not.toContain("sync");
    expect(events.some((e) => e.startsWith("invalidate"))).toBe(false);
    expect(statuses.at(-1)?.status).toBe("failed");
    expect(statuses.at(-1)?.error).toContain("invalid site data");
  });

  it("truncates very long error messages", async () => {
    const { deps, statuses } = makeDeps({
      sync: async () => {
        throw new Error("x".repeat(5000));
      },
    });
    await expect(runBuild(deps, "m")).rejects.toThrow();
    expect(statuses.at(-1)?.error).toHaveLength(1000);
  });
});
```

`services/build/test/config.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

const env = { TABLE_NAME: "BlogTable", SITE_BUCKET: "blog-site", DISTRIBUTION_ID: "E123" };

describe("loadConfig", () => {
  it("applies Lambda defaults for the writable and read-only directories", () => {
    expect(loadConfig(env)).toEqual({
      ...env,
      SOURCE_DIR: "/opt/blog",
      WORK_DIR: "/tmp/blog",
      DATA_DIR: "/tmp/site-data",
    });
  });

  it("fails fast without the site bucket", () => {
    const { SITE_BUCKET: _omit, ...rest } = env;
    expect(() => loadConfig(rest)).toThrow(/SITE_BUCKET/);
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `pnpm --filter @blog/build exec vitest run test/runBuild.test.ts test/config.test.ts`
Expected: FAIL — không resolve được `../src/runBuild`, `../src/config`.

- [ ] **Step 3: Viết mã**

`services/build/src/status.ts`:
```ts
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
```

`services/build/src/invalidate.ts`:
```ts
import { type CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";

export async function invalidateAll(
  cf: CloudFrontClient,
  distributionId: string,
  callerReference: string,
): Promise<void> {
  await cf.send(
    new CreateInvalidationCommand({
      DistributionId: distributionId,
      InvalidationBatch: {
        CallerReference: callerReference,
        Paths: { Quantity: 1, Items: ["/*"] },
      },
    }),
  );
}
```

`services/build/src/runBuild.ts`:
```ts
import type { BuildPhase } from "./status";
import type { SyncPlan } from "./syncSite";

const MAX_ERROR_LENGTH = 1000;

export interface BuildDeps {
  now(): string;
  status: { set(status: BuildPhase, now: string, error?: string | null): Promise<void> };
  /** Prepares the writable workspace (no-op after the first call in a container). */
  prepare(): void;
  exportData(dir: string): Promise<{ posts: number; tags: number }>;
  buildSite(dataDir: string): Promise<string>;
  sync(distDir: string): Promise<SyncPlan>;
  invalidate(reference: string): Promise<void>;
  log: {
    info(message: string, attributes: Record<string, unknown>): void;
    error(message: string, attributes: Record<string, unknown>): void;
  };
  /** Where exportData writes and the site build reads; never the site fixtures. */
  dataDir: string;
}

/** One build. The S3 site is only touched after the site build succeeded. */
export async function runBuild(deps: BuildDeps, reference: string): Promise<void> {
  await deps.status.set("running", deps.now());
  try {
    deps.prepare();
    const counts = await deps.exportData(deps.dataDir);
    const distDir = await deps.buildSite(deps.dataDir);
    const plan = await deps.sync(distDir);
    await deps.invalidate(reference);
    await deps.status.set("success", deps.now());
    deps.log.info("build finished", {
      ...counts,
      uploaded: plan.assets.length + plan.pages.length,
      deleted: plan.deletes.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.log.error("build failed", { error: err });
    await deps.status.set("failed", deps.now(), message.slice(0, MAX_ERROR_LENGTH));
    throw err;
  }
}
```

`services/build/src/config.ts`:
```ts
import { z } from "zod";

const configSchema = z.object({
  TABLE_NAME: z.string().min(1),
  SITE_BUCKET: z.string().min(1),
  DISTRIBUTION_ID: z.string().min(1),
  /** Read-only monorepo with node_modules, baked into the image. */
  SOURCE_DIR: z.string().min(1).default("/opt/blog"),
  /** Writable copy used for building. */
  WORK_DIR: z.string().min(1).default("/tmp/blog"),
  /** Exported posts.json / tags.json. */
  DATA_DIR: z.string().min(1).default("/tmp/site-data"),
});
export type Config = z.infer<typeof configSchema>;

export const loadConfig = (env: Record<string, string | undefined>): Config =>
  configSchema.parse(env);
```

`services/build/src/deps.ts`:
```ts
import { CloudFrontClient } from "@aws-sdk/client-cloudfront";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { Config } from "./config";
import { exportSiteData } from "./exportData";
import { invalidateAll } from "./invalidate";
import type { BuildDeps } from "./runBuild";
import { prepareWorkspace, runSiteBuild } from "./siteBuild";
import { DynamoBuildStatus } from "./status";
import { syncToS3 } from "./syncSite";

export function createDeps(config: Config, log: BuildDeps["log"]): BuildDeps {
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const s3 = new S3Client({});
  const cf = new CloudFrontClient({});
  return {
    now: () => new Date().toISOString(),
    status: new DynamoBuildStatus(db, config.TABLE_NAME),
    prepare: () => prepareWorkspace(config.SOURCE_DIR, config.WORK_DIR),
    exportData: (dir) => exportSiteData(db, config.TABLE_NAME, dir),
    buildSite: (dataDir) => runSiteBuild({ workDir: config.WORK_DIR, dataDir }),
    sync: (distDir) => syncToS3(s3, config.SITE_BUCKET, distDir),
    invalidate: (reference) => invalidateAll(cf, config.DISTRIBUTION_ID, reference),
    log,
    dataDir: config.DATA_DIR,
  };
}
```

`services/build/src/index.ts`:
```ts
import { Logger } from "@aws-lambda-powertools/logger";
import type { SQSEvent } from "aws-lambda";
import { loadConfig } from "./config";
import { createDeps } from "./deps";
import { type BuildDeps, runBuild } from "./runBuild";

const logger = new Logger({ serviceName: "blog-build" });
let deps: BuildDeps | undefined;

const reasonOf = (body: string): string => {
  try {
    return String((JSON.parse(body) as { reason?: unknown }).reason ?? "unknown");
  } catch {
    return "unknown";
  }
};

/**
 * SQS FIFO (one message group) delivers up to 10 requests per invocation: all of them are
 * satisfied by one build, because the build reads the latest data when it starts.
 * Throwing fails the whole batch so SQS retries it (then the DLQ).
 */
export async function handler(event: SQSEvent): Promise<void> {
  deps ??= createDeps(loadConfig(process.env), logger);
  logger.info("build requested", { reasons: event.Records.map((r) => reasonOf(r.body)) });
  const reference = event.Records.at(-1)?.messageId ?? deps.now();
  await runBuild(deps, reference);
}
```

- [ ] **Step 4: Chạy test để thấy thành công**

Run: `pnpm --filter @blog/build test && pnpm --filter @blog/build typecheck`
Expected: PASS; typecheck sạch. Nếu `typecheck` báo `logger` (Powertools) không khớp `BuildDeps["log"]`, giữ kiểu `log` dạng method như trên (so khớp tham số hai chiều) — giống cách `Log` của `services/api`.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add services/build
git commit -m "feat(build): build orchestration, status, invalidation and SQS handler" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Bundle, container image & chạy thử chỉ-đọc

**Files:**
- Create: `services/build/scripts/bundle.mjs`, `services/build/src/smoke.ts`, `services/build/Dockerfile`, `.dockerignore`

**Interfaces:**
- Consumes: Task 1–4.
- Produces (Kế hoạch 4 dùng):
  - Image build từ **thư mục gốc repo**: `docker build --platform linux/amd64 -f services/build/Dockerfile .`
  - Handler `index.handler` (file `/var/task/index.mjs`), mã nguồn + thư viện ở `/opt/blog`.
  - `/var/task/smoke.mjs`: build site từ fixtures trong `/tmp` để kiểm tra image.

- [ ] **Step 1: Script bundle**

`services/build/scripts/bundle.mjs`:
```js
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts", "src/smoke.ts"],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  // Some bundled CommonJS dependencies call require().
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: "info",
});
```

`services/build/src/smoke.ts`:
```ts
import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { prepareWorkspace, runSiteBuild } from "./siteBuild";

// Image smoke test: build the fixture site exactly like the Lambda does, writing only to /tmp.
const sourceDir = process.env.SOURCE_DIR ?? "/opt/blog";
const workDir = process.env.WORK_DIR ?? "/tmp/blog";
const dataDir = "/tmp/smoke-data";

mkdirSync(dataDir, { recursive: true });
cpSync(join(sourceDir, "apps/site/fixtures"), dataDir, { recursive: true });
prepareWorkspace(sourceDir, workDir);
const distDir = await runSiteBuild({ workDir, dataDir });
const pages = readdirSync(distDir, { recursive: true }).filter((p) => String(p).endsWith(".html"));
console.log(`smoke ok: ${pages.length} pages`);
```

Run: `pnpm --filter @blog/build bundle && node -e "import('./services/build/dist/index.mjs').then(m => console.log(typeof m.handler))"`
Expected: in ra `function`.

Thêm `services/build/dist/` không cần — `.gitignore` đã có `dist/`.

- [ ] **Step 2: `.dockerignore` & Dockerfile**

`.dockerignore` (ở gốc repo):
```
**/node_modules
**/dist
**/.astro
**/.cache
.git
.superpowers
.claude
docs
```

`services/build/Dockerfile`:
```dockerfile
# Build context: repository root.
#   docker build --platform linux/amd64 -f services/build/Dockerfile -t blog-build .

FROM --platform=linux/amd64 node:24-bookworm-slim AS deps
WORKDIR /repo
RUN npm install -g pnpm@12.10.1
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json biome.json ./
COPY packages ./packages
COPY services/api ./services/api
COPY services/build ./services/build
COPY apps/site ./apps/site
# Linux x64 binaries (esbuild, rolldown, pagefind) are installed here, matching the Lambda.
RUN pnpm install --frozen-lockfile --filter "@blog/site..." --filter "@blog/build..."
RUN pnpm --filter @blog/build bundle

FROM --platform=linux/amd64 public.ecr.aws/lambda/nodejs:24
# Read-only monorepo used as the build source; the handler copies sources to /tmp.
COPY --from=deps /repo /opt/blog
COPY --from=deps /repo/services/build/dist/ ${LAMBDA_TASK_ROOT}/
ENV ASTRO_TELEMETRY_DISABLED=1
CMD ["index.handler"]
```

- [ ] **Step 3: Build image**

Run: `docker build --platform linux/amd64 -f services/build/Dockerfile -t blog-build:local .`
Expected: build thành công (lần đầu vài phút vì giả lập x86_64 trên Apple Silicon).

> Nếu `pnpm install --frozen-lockfile --filter …` báo lockfile không khớp vì thiếu thư mục workspace, thêm `COPY` cho package còn thiếu được liệt kê trong lỗi — không bỏ `--frozen-lockfile`.

- [ ] **Step 4: Chạy thử với filesystem chỉ-đọc**

Run:
```bash
docker run --rm --platform linux/amd64 --read-only --tmpfs /tmp:rw,exec,size=2g --entrypoint node blog-build:local /var/task/smoke.mjs
```
Expected: dòng cuối `smoke ok: 20 pages`. Mọi lỗi `EROFS` (ghi vào chỗ chỉ-đọc) là lỗi của plan → sửa cấu hình cache/HOME, ghi Ruling.

- [ ] **Step 5: Kiểm tra toàn bộ**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test`
Expected: lint sạch (chỉ còn info `recommended`), typecheck sạch, mọi test PASS.

- [ ] **Step 6: Commit**

```bash
git add .dockerignore services/build
git commit -m "feat(build): bundle, Lambda container image and read-only smoke test" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Hoàn tất Kế hoạch 3

- `pnpm lint && pnpm typecheck && pnpm test` xanh; image `blog-build:local` chạy `smoke.mjs` thành công với `--read-only`.
- Kế hoạch 4 khai báo: `DockerImageFunction` (x86_64, 2048 MB, timeout 5 phút, ephemeral storage 2 GB) từ `services/build/Dockerfile` với context gốc repo; biến môi trường `TABLE_NAME`, `SITE_BUCKET`, `DISTRIBUTION_ID`; event source SQS FIFO `batchSize: 10`, DLQ `maxReceiveCount: 2`; quyền: đọc bảng (Query GSI `byUpdated`) + ghi item `BUILD/LATEST`, `s3:ListBucket`/`PutObject`/`DeleteObject` trên bucket site, `cloudfront:CreateInvalidation` trên distribution blog.
