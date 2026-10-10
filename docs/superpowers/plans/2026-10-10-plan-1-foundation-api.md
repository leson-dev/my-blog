# Kế hoạch 1: Nền móng & API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng monorepo pnpm và hoàn thiện toàn bộ logic của Lambda API (domain, use case, adapter AWS, HTTP router), test đầy đủ trên máy mà không cần tài khoản AWS.

**Architecture:** `packages/shared` chứa kiểu dữ liệu + zod schema dùng chung. `services/api` chia 4 lớp: `domain/` (hàm thuần, không import AWS SDK) → `usecases/` (điều phối qua các interface "port") → `adapters/` (DynamoDB, SQS, EventBridge Scheduler, S3) → `handlers/` (API Gateway HTTP API + sự kiện Scheduler). Use case được test bằng adapter giả trong bộ nhớ; adapter được test bằng `aws-sdk-client-mock`.

**Tech Stack:** Node.js 24, TypeScript 7.0.2, pnpm 12.10.1 (workspaces + catalog), Vitest 5.0.3, zod 4.6.5, AWS SDK for JavaScript v3 (3.1149.0), Powertools for AWS Lambda Logger 2.36.0, ulid 3.0.2, Biome 2.5.15.

**Spec:** [`docs/superpowers/specs/2026-10-10-serverless-blog-design.md`](../specs/2026-10-10-serverless-blog-design.md) — đọc mục 2 (Dữ liệu & API), 3 (Luồng publish & build), 4.3 (Cấu trúc code), 5.1–5.2 (Lỗi & bảo mật) trước khi bắt đầu.

**Vị trí trong lộ trình:** Kế hoạch 1/6. Các kế hoạch sau: (2) Markdown + site Astro, (3) Lambda Build, (4) Hạ tầng CDK + deploy, (5) Trang quản trị, (6) CI/CD + E2E. Kế hoạch này **không** deploy gì lên AWS.

## Global Constraints

- Runtime: **Node.js 24** (Lambda `nodejs24.x` — Kế hoạch 4 xác nhận lại khi deploy). Máy local: `node -v` ≥ v24.
- Package manager: **pnpm 12.10.1**, workspaces; phiên bản thư viện khai báo **một lần** trong `catalog:` của `pnpm-workspace.yaml`.
- TypeScript **7.0.2**, `strict` + `noUncheckedIndexedAccess`; source TS được import trực tiếp giữa các package (không bước build).
- Lint/format: **Biome 2.5.15**. Test: **Vitest 5.0.3**.
- `services/api/src/domain/**` **không được import** `@aws-sdk/*` hay bất kỳ thứ gì từ `adapters/`.
- Mọi thời điểm lưu dạng **ISO 8601 UTC** do `Date.prototype.toISOString()` sinh ra (ví dụ `2026-10-12T08:00:00.000Z`).
- DynamoDB một bảng: `PK`/`SK` kiểu chuỗi. Bài viết `POST#<id>` / `POST`; giữ slug `SLUG#<slug>` / `SLUG`; trạng thái build `BUILD` / `LATEST`. GSI tên **`byUpdated`** với `GSI1PK = "POST"`, `GSI1SK = updatedAt`.
- SQS FIFO: `MessageGroupId = "site"`, `MessageDeduplicationId` = UUID ngẫu nhiên mỗi lần gửi.
- Định dạng lỗi API: `{ "error": { "code": "<CODE>", "message": "..." } }`. Mã: `VALIDATION_ERROR`→400, `FORBIDDEN`→403, `NOT_FOUND`→404, `VERSION_CONFLICT`/`SLUG_TAKEN`/`INVALID_STATE`→409, `INTERNAL`→500.
- Nhóm Cognito **`e2e`** bị cấm (`403`): `POST /posts/{id}/publish`, `POST /posts/{id}/unpublish`, `POST /builds`.
- Upload ảnh: chỉ `image/jpeg|png|webp|gif|avif` (**không SVG**), 1 byte – 10 MB, presigned POST hết hạn 300 s, key `media/<yyyy>/<ulid>.<ext>`; tài khoản E2E dùng `media/e2e/<ulid>.<ext>`.
- Schedule EventBridge: tên `post-<id>`, `at(yyyy-mm-ddThh:mm:ss)` theo UTC, `ActionAfterCompletion: DELETE`. Hẹn giờ cách hiện tại ≤ 60 giây được coi là "đăng ngay".
- Commit message kết thúc bằng dòng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Tiêu đề/tag không có chữ Latin** (tiêu đề tiếng Nhật `日本語のタイトル`, tag `日本語`): slug phải tự rơi về ID bài (chữ thường), tag không chuyển được phải báo `400` rõ ràng — không được lặng lẽ sinh slug rỗng hay mất tag. → Task 2, Task 3.
2. **Nội dung dài tính theo byte, không theo ký tự**: bài tiếng Việt ~100.001 ký tự `ệ` (3 byte/ký tự) vượt 300 KB phải bị từ chối `400` ở bước validate, không để DynamoDB ném lỗi 400KB thành `500`. → Task 1.
3. **Giờ hẹn sát nút / sai định dạng**: `publishAt` trong vòng 60 giây tới → đăng ngay (không tạo schedule đã quá hạn); có offset `+09:00` → `400`; có mili-giây → chuẩn hoá về giây để khớp với sự kiện Scheduler. → Task 1, Task 3.
4. **Lịch cũ chạy sau khi tác giả đổi giờ/huỷ/xoá bài, hoặc tự lưu chạy đúng lúc lịch nổ**: sự kiện lệch `publishAt` hoặc bài đã xoá → bỏ qua, không build; xung đột version → ném lỗi để Scheduler thử lại. → Task 5.
5. **Nội dung độc hại qua ảnh/ảnh bìa**: upload `image/svg+xml` và `coverImage = "javascript:alert(1)"` phải bị từ chối `400`. → Task 1.

---

## Cấu trúc file

```
my-blog/
├── package.json                  # Task 1 — scripts gốc, Biome
├── pnpm-workspace.yaml           # Task 1 — workspaces + catalog phiên bản
├── tsconfig.base.json            # Task 1
├── biome.json                    # Task 1
├── .nvmrc                        # Task 1
├── packages/shared/
│   ├── package.json, tsconfig.json
│   ├── src/index.ts              # re-export
│   ├── src/post.ts               # Post, PostStatus, LIMITS, utf8Bytes, schema tạo/sửa/publish
│   ├── src/build.ts              # BuildState
│   ├── src/errors.ts             # ErrorCode, ApiErrorBody
│   ├── src/upload.ts             # IMAGE_EXTENSIONS, schema upload, UploadTicket
│   └── test/schemas.test.ts
└── services/api/
    ├── package.json, tsconfig.json
    ├── src/
    │   ├── domain/errors.ts      # DomainError
    │   ├── domain/slug.ts        # slugify, isValidSlug, normalizeTags
    │   ├── domain/post.ts        # newPost, applyUpdate, publish, unpublish, publishScheduled, needsRebuild, toSummary
    │   ├── usecases/ports.ts     # interface PostRepository, BuildStatusRepository, BuildQueue, PublishScheduler, UploadSigner, Deps
    │   ├── usecases/builds.ts    # requestBuild, getLatestBuild, triggerBuild
    │   ├── usecases/posts.ts     # listPosts, getPost, createPost, updatePost, deletePost
    │   ├── usecases/publishing.ts# publishPost, unpublishPost, runScheduledPublish
    │   ├── usecases/uploads.ts   # createUpload
    │   ├── events.ts             # schema sự kiện Scheduler
    │   ├── adapters/dynamo/items.ts, postRepo.ts, buildStatusRepo.ts
    │   ├── adapters/sqs/buildQueue.ts
    │   ├── adapters/scheduler/publishScheduler.ts
    │   ├── adapters/s3/uploadSigner.ts
    │   ├── handlers/http/response.ts, auth.ts, router.ts
    │   ├── handlers/scheduled.ts
    │   ├── config.ts, deps.ts    # đọc env + ghép adapter thật
    │   └── index.ts              # entry Lambda
    └── test/ (fakes.ts, fixtures.ts, *.test.ts tương ứng)
```

---

### Task 1: Monorepo + `packages/shared`

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `.nvmrc`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`
- Create: `packages/shared/src/{index,post,build,errors,upload}.ts`
- Test: `packages/shared/test/schemas.test.ts`

**Interfaces:**
- Consumes: không có.
- Produces (import từ `@blog/shared`):
  - `type PostStatus = "draft" | "scheduled" | "published"`
  - `interface Post { id; slug; title; excerpt; content; tags: string[]; coverImage: string | null; status: PostStatus; publishAt: string | null; publishedAt: string | null; createdAt: string; updatedAt: string; version: number }`
  - `type PostSummary = Omit<Post, "content">`
  - `LIMITS = { titleMax: 200, excerptMax: 500, contentMaxBytes: 300_000, tagsMax: 20, tagMax: 30, slugMax: 100 }`
  - `utf8Bytes(s: string): number`
  - `createPostInputSchema` → `CreatePostInput`, `updatePostInputSchema` → `UpdatePostInput`, `publishInputSchema` → `PublishInput`
  - `IMAGE_EXTENSIONS`, `type ImageContentType`, `createUploadInputSchema` → `CreateUploadInput`, `interface UploadTicket { url; fields: Record<string,string>; key; publicUrl }`
  - `type BuildStatus = "idle" | "queued" | "running" | "success" | "failed"`, `interface BuildState { status: BuildStatus; updatedAt: string | null; error: string | null }`
  - `type ErrorCode`, `interface ApiErrorBody`

- [ ] **Step 1: Cài pnpm và tạo nhánh làm việc**

```bash
npm install -g pnpm@12.10.1
pnpm -v
git checkout -b feat/plan-1-api
```
Expected: `pnpm -v` in ra `12.10.1`.

- [ ] **Step 2: Tạo các file gốc của monorepo**

`package.json`:
```json
{
  "name": "my-blog",
  "private": true,
  "packageManager": "pnpm@12.10.1",
  "engines": { "node": ">=24" },
  "scripts": {
    "lint": "biome check .",
    "format": "biome check --write .",
    "typecheck": "pnpm -r --if-present typecheck",
    "test": "pnpm -r --if-present test"
  },
  "devDependencies": {
    "@biomejs/biome": "2.5.15"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - apps/*
  - services/*
  - packages/*
  - infra
  - e2e

catalog:
  typescript: 7.0.2
  vitest: 5.0.3
  "@types/node": ^24.0.0
  "@types/aws-lambda": 8.10.164
  zod: 4.6.5
  ulid: 3.0.2
  aws-sdk-client-mock: 4.1.0
  "@aws-lambda-powertools/logger": 2.36.0
  "@aws-sdk/client-dynamodb": 3.1149.0
  "@aws-sdk/lib-dynamodb": 3.1149.0
  "@aws-sdk/client-sqs": 3.1149.0
  "@aws-sdk/client-scheduler": 3.1149.0
  "@aws-sdk/client-s3": 3.1149.0
  "@aws-sdk/s3-presigned-post": 3.1149.0
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2024",
    "lib": ["ES2024"],
    "module": "preserve",
    "moduleResolution": "bundler",
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  }
}
```

`biome.json`:
```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.15/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "includes": ["**", "!**/docs"] },
  "formatter": { "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "javascript": { "formatter": { "quoteStyle": "double", "semicolons": "always" } }
}
```

`.nvmrc`:
```
24
```

- [ ] **Step 3: Tạo khung `packages/shared`**

`packages/shared/package.json`:
```json
{
  "name": "@blog/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "catalog:"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

`packages/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

Run: `pnpm install`
Expected: cài thành công, sinh `pnpm-lock.yaml`. (Nếu pnpm cảnh báo "ignored build scripts", chạy `pnpm approve-builds` và chấp thuận `esbuild`.)

- [ ] **Step 4: Viết test thất bại cho schema**

`packages/shared/test/schemas.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  createPostInputSchema,
  createUploadInputSchema,
  LIMITS,
  publishInputSchema,
  updatePostInputSchema,
  utf8Bytes,
} from "../src/index";

describe("createPostInputSchema", () => {
  it("applies defaults for optional fields", () => {
    const parsed = createPostInputSchema.parse({ title: "Học AWS" });
    expect(parsed).toEqual({
      title: "Học AWS",
      excerpt: "",
      content: "",
      tags: [],
      coverImage: null,
    });
  });

  it("rejects a whitespace-only title", () => {
    expect(createPostInputSchema.safeParse({ title: "   " }).success).toBe(false);
  });

  it("measures content size in UTF-8 bytes, not characters", () => {
    const content = "ệ".repeat(100_001); // 100,001 chars but 300,003 bytes
    expect(content.length).toBeLessThan(LIMITS.contentMaxBytes);
    expect(utf8Bytes(content)).toBeGreaterThan(LIMITS.contentMaxBytes);
    expect(createPostInputSchema.safeParse({ title: "t", content }).success).toBe(false);
  });

  it("rejects a javascript: cover image", () => {
    const r = createPostInputSchema.safeParse({ title: "t", coverImage: "javascript:alert(1)" });
    expect(r.success).toBe(false);
  });

  it("accepts media and https cover images", () => {
    for (const coverImage of ["/media/2026/x.webp", "https://blog.oki-dev.xyz/media/2026/x.webp"]) {
      expect(createPostInputSchema.safeParse({ title: "t", coverImage }).success).toBe(true);
    }
  });
});

describe("updatePostInputSchema", () => {
  it("requires a positive integer version", () => {
    const base = { title: "t", slug: "t", excerpt: "", content: "", tags: [], coverImage: null };
    expect(updatePostInputSchema.safeParse({ ...base, version: 0 }).success).toBe(false);
    expect(updatePostInputSchema.safeParse({ ...base, version: 1.5 }).success).toBe(false);
    expect(updatePostInputSchema.safeParse({ ...base, version: 3 }).success).toBe(true);
  });
});

describe("publishInputSchema", () => {
  it("accepts an empty body (publish now)", () => {
    expect(publishInputSchema.parse({})).toEqual({});
  });

  it("accepts UTC timestamps with or without milliseconds", () => {
    expect(publishInputSchema.safeParse({ publishAt: "2026-10-12T08:00:00Z" }).success).toBe(true);
    expect(publishInputSchema.safeParse({ publishAt: "2026-10-12T08:00:00.123Z" }).success).toBe(
      true,
    );
  });

  it("rejects timestamps with a timezone offset", () => {
    const r = publishInputSchema.safeParse({ publishAt: "2026-10-12T08:00:00+09:00" });
    expect(r.success).toBe(false);
  });
});

describe("createUploadInputSchema", () => {
  it("accepts raster image types", () => {
    for (const contentType of ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]) {
      expect(createUploadInputSchema.safeParse({ contentType }).success).toBe(true);
    }
  });

  it("rejects SVG (can carry scripts)", () => {
    expect(createUploadInputSchema.safeParse({ contentType: "image/svg+xml" }).success).toBe(false);
  });
});
```

- [ ] **Step 5: Chạy test để thấy thất bại**

Run: `pnpm --filter @blog/shared test`
Expected: FAIL — `Failed to resolve import "../src/index"` (file chưa tồn tại).

- [ ] **Step 6: Viết mã `packages/shared/src`**

`packages/shared/src/post.ts`:
```ts
import { z } from "zod";

export const POST_STATUSES = ["draft", "scheduled", "published"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export interface Post {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  tags: string[];
  coverImage: string | null;
  status: PostStatus;
  publishAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export type PostSummary = Omit<Post, "content">;

export const LIMITS = {
  titleMax: 200,
  excerptMax: 500,
  contentMaxBytes: 300_000,
  tagsMax: 20,
  tagMax: 30,
  slugMax: 100,
} as const;

const encoder = new TextEncoder();
export const utf8Bytes = (s: string): number => encoder.encode(s).length;

const titleSchema = z.string().trim().min(1).max(LIMITS.titleMax);
const excerptSchema = z.string().max(LIMITS.excerptMax);
const contentSchema = z
  .string()
  .refine((s) => utf8Bytes(s) <= LIMITS.contentMaxBytes, {
    message: `content must be at most ${LIMITS.contentMaxBytes} bytes`,
  });
const tagsSchema = z.array(z.string().max(LIMITS.tagMax)).max(LIMITS.tagsMax);
const coverImageSchema = z
  .string()
  .max(500)
  .regex(/^(\/media\/|https:\/\/)/, "cover image must be a /media/ path or an https URL")
  .nullable();

export const createPostInputSchema = z.object({
  title: titleSchema,
  slug: z.string().max(LIMITS.slugMax).optional(),
  excerpt: excerptSchema.default(""),
  content: contentSchema.default(""),
  tags: tagsSchema.default([]),
  coverImage: coverImageSchema.default(null),
});
export type CreatePostInput = z.infer<typeof createPostInputSchema>;

export const updatePostInputSchema = z.object({
  title: titleSchema,
  slug: z.string().min(1).max(LIMITS.slugMax),
  excerpt: excerptSchema,
  content: contentSchema,
  tags: tagsSchema,
  coverImage: coverImageSchema,
  version: z.number().int().positive(),
});
export type UpdatePostInput = z.infer<typeof updatePostInputSchema>;

export const publishInputSchema = z.object({
  publishAt: z.iso.datetime().optional(),
});
export type PublishInput = z.infer<typeof publishInputSchema>;
```

`packages/shared/src/build.ts`:
```ts
export const BUILD_STATUSES = ["idle", "queued", "running", "success", "failed"] as const;
export type BuildStatus = (typeof BUILD_STATUSES)[number];

export interface BuildState {
  status: BuildStatus;
  updatedAt: string | null;
  error: string | null;
}
```

`packages/shared/src/errors.ts`:
```ts
export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "FORBIDDEN",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "SLUG_TAKEN",
  "INVALID_STATE",
  "INTERNAL",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string };
}
```

`packages/shared/src/upload.ts`:
```ts
import { z } from "zod";

export const IMAGE_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
} as const;
export type ImageContentType = keyof typeof IMAGE_EXTENSIONS;

const IMAGE_CONTENT_TYPES = Object.keys(IMAGE_EXTENSIONS) as [
  ImageContentType,
  ...ImageContentType[],
];

export const createUploadInputSchema = z.object({
  contentType: z.enum(IMAGE_CONTENT_TYPES),
});
export type CreateUploadInput = z.infer<typeof createUploadInputSchema>;

export interface UploadTicket {
  url: string;
  fields: Record<string, string>;
  key: string;
  publicUrl: string;
}
```

`packages/shared/src/index.ts`:
```ts
export * from "./build";
export * from "./errors";
export * from "./post";
export * from "./upload";
```

- [ ] **Step 7: Chạy test để thấy thành công**

Run: `pnpm --filter @blog/shared test`
Expected: PASS — 11 test.

- [ ] **Step 8: Lint + typecheck**

Run: `pnpm format && pnpm lint && pnpm typecheck`
Expected: không lỗi.

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json biome.json .nvmrc packages/shared
git commit -m "feat(shared): scaffold pnpm monorepo and shared post schemas" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `services/api` — slug, tag và lỗi miền

**Files:**
- Create: `services/api/package.json`, `services/api/tsconfig.json`
- Create: `services/api/src/domain/errors.ts`, `services/api/src/domain/slug.ts`
- Test: `services/api/test/domain/slug.test.ts`

**Interfaces:**
- Consumes: `LIMITS`, `ErrorCode` từ `@blog/shared`.
- Produces:
  - `class DomainError extends Error { readonly code: ErrorCode }`; `notFound(what: string): DomainError`
  - `slugify(input: string): string` — có thể trả `""` khi không có chữ Latin/số
  - `isValidSlug(s: string): boolean`
  - `normalizeTags(tags: string[]): string[]` — ném `DomainError("VALIDATION_ERROR")` nếu một tag không chuyển được

- [ ] **Step 1: Tạo khung package**

`services/api/package.json`:
```json
{
  "name": "@blog/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@blog/shared": "workspace:*",
    "@aws-lambda-powertools/logger": "catalog:",
    "@aws-sdk/client-dynamodb": "catalog:",
    "@aws-sdk/lib-dynamodb": "catalog:",
    "@aws-sdk/client-sqs": "catalog:",
    "@aws-sdk/client-scheduler": "catalog:",
    "@aws-sdk/client-s3": "catalog:",
    "@aws-sdk/s3-presigned-post": "catalog:",
    "ulid": "catalog:",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@types/aws-lambda": "catalog:",
    "@types/node": "catalog:",
    "aws-sdk-client-mock": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

`services/api/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

Run: `pnpm install`
Expected: cài thành công.

- [ ] **Step 2: Viết test thất bại**

`services/api/test/domain/slug.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { isValidSlug, normalizeTags, slugify } from "../../src/domain/slug";

describe("slugify", () => {
  it.each([
    ["Học AWS Lambda cơ bản", "hoc-aws-lambda-co-ban"],
    ["Đà Nẵng mùa hè", "da-nang-mua-he"],
    ["  Hello,   World!! ", "hello-world"],
    ["Next.js 15 & Astro 5", "next-js-15-astro-5"],
    ["Ánh Sáng ĐÊM", "anh-sang-dem"],
  ])("%s -> %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("returns an empty string when there is nothing latin or numeric", () => {
    expect(slugify("日本語のタイトル")).toBe("");
    expect(slugify("!!!")).toBe("");
  });

  it("truncates at a word boundary without a trailing dash", () => {
    const input = Array.from({ length: 11 }, () => "abcdefghij").join(" ");
    const slug = slugify(input);
    expect(slug.length).toBe(98);
    expect(slug.endsWith("-")).toBe(false);
    expect(isValidSlug(slug)).toBe(true);
  });
});

describe("isValidSlug", () => {
  it("accepts lowercase words separated by single dashes", () => {
    expect(isValidSlug("hoc-aws")).toBe(true);
  });

  it.each(["", "-a", "a-", "a--b", "Hoc", "học"])("rejects %j", (s) => {
    expect(isValidSlug(s)).toBe(false);
  });
});

describe("normalizeTags", () => {
  it("slugifies, lowercases and de-duplicates while keeping order", () => {
    expect(normalizeTags(["AWS", " aws ", "Serverless", "AWS Lambda"])).toEqual([
      "aws",
      "serverless",
      "aws-lambda",
    ]);
  });

  it("rejects a tag that has no latin letters or digits", () => {
    expect(() => normalizeTags(["aws", "日本語"])).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
  });
});
```

- [ ] **Step 3: Chạy test để thấy thất bại**

Run: `pnpm --filter @blog/api test`
Expected: FAIL — không resolve được `../../src/domain/slug`.

- [ ] **Step 4: Viết mã**

`services/api/src/domain/errors.ts`:
```ts
import type { ErrorCode } from "@blog/shared";

export class DomainError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

export const notFound = (what: string): DomainError =>
  new DomainError("NOT_FOUND", `${what} not found`);
```

`services/api/src/domain/slug.ts`:
```ts
import { LIMITS } from "@blog/shared";
import { DomainError } from "./errors";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugify(input: string): string {
  const base = input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base.length <= LIMITS.slugMax) return base;

  const cut = base.slice(0, LIMITS.slugMax);
  if (base[LIMITS.slugMax] === "-") return cut;
  const lastDash = cut.lastIndexOf("-");
  return lastDash > 0 ? cut.slice(0, lastDash) : cut;
}

export function isValidSlug(s: string): boolean {
  return s.length <= LIMITS.slugMax && SLUG_PATTERN.test(s);
}

export function normalizeTags(tags: string[]): string[] {
  const result: string[] = [];
  for (const raw of tags) {
    const tag = slugify(raw);
    if (tag === "") {
      throw new DomainError(
        "VALIDATION_ERROR",
        `tag "${raw}" must contain at least one latin letter or digit`,
      );
    }
    if (!result.includes(tag)) result.push(tag);
  }
  return result;
}
```

- [ ] **Step 5: Chạy test để thấy thành công**

Run: `pnpm --filter @blog/api test`
Expected: PASS.

- [ ] **Step 6: Lint + typecheck rồi commit**

```bash
pnpm format && pnpm lint && pnpm typecheck
git add services/api pnpm-lock.yaml
git commit -m "feat(api): add slug and tag normalization" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Vòng đời bài viết (domain thuần)

**Files:**
- Create: `services/api/src/domain/post.ts`
- Test: `services/api/test/domain/post.test.ts`

**Interfaces:**
- Consumes: `Post`, `PostSummary`, `CreatePostInput`, `UpdatePostInput` (`@blog/shared`); `DomainError`, `slugify`, `isValidSlug`, `normalizeTags` (Task 2).
- Produces:
  - `SCHEDULE_MIN_LEAD_MS = 60_000`
  - `newPost(input: CreatePostInput, ctx: { id: string; now: string }): Post`
  - `applyUpdate(post: Post, input: UpdatePostInput, now: string): Post`
  - `publish(post: Post, publishAt: string | undefined, now: string): Post`
  - `unpublish(post: Post, now: string): Post`
  - `publishScheduled(post: Post, scheduledFor: string, now: string): Post | null`
  - `needsRebuild(before: Post | null, after: Post | null): boolean`
  - `toSummary(post: Post): PostSummary`

- [ ] **Step 1: Viết test thất bại**

`services/api/test/domain/post.test.ts`:
```ts
import type { Post } from "@blog/shared";
import { describe, expect, it } from "vitest";
import {
  applyUpdate,
  needsRebuild,
  newPost,
  publish,
  publishScheduled,
  toSummary,
  unpublish,
} from "../../src/domain/post";

const NOW = "2026-10-10T00:00:00.000Z";
const ID = "01JABCDEFGHJKMNPQRSTVWXYZ0";

const draft = (overrides: Partial<Post> = {}): Post => ({
  ...newPost(
    { title: "Học AWS", excerpt: "", content: "# Hi", tags: ["AWS"], coverImage: null },
    { id: ID, now: NOW },
  ),
  ...overrides,
});

describe("newPost", () => {
  it("creates a draft at version 1 with a slug from the title", () => {
    expect(draft()).toEqual({
      id: ID,
      slug: "hoc-aws",
      title: "Học AWS",
      excerpt: "",
      content: "# Hi",
      tags: ["aws"],
      coverImage: null,
      status: "draft",
      publishAt: null,
      publishedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
      version: 1,
    });
  });

  it("falls back to the lowercase id when the title has no latin characters", () => {
    const post = newPost(
      { title: "日本語のタイトル", excerpt: "", content: "", tags: [], coverImage: null },
      { id: ID, now: NOW },
    );
    expect(post.slug).toBe(ID.toLowerCase());
  });

  it("normalizes an explicit slug", () => {
    const post = newPost(
      { title: "x", slug: "My Custom Slug", excerpt: "", content: "", tags: [], coverImage: null },
      { id: ID, now: NOW },
    );
    expect(post.slug).toBe("my-custom-slug");
  });

  it("rejects an explicit slug with no latin characters", () => {
    expect(() =>
      newPost(
        { title: "x", slug: "日本", excerpt: "", content: "", tags: [], coverImage: null },
        { id: ID, now: NOW },
      ),
    ).toThrowError(expect.objectContaining({ code: "VALIDATION_ERROR" }));
  });
});

describe("applyUpdate", () => {
  const input = {
    title: "New title",
    slug: "new-title",
    excerpt: "e",
    content: "c",
    tags: ["Astro"],
    coverImage: "/media/2026/a.webp",
    version: 1,
  };

  it("replaces editable fields and bumps the version", () => {
    const next = applyUpdate(draft(), input, "2026-10-11T00:00:00.000Z");
    expect(next).toMatchObject({
      title: "New title",
      slug: "new-title",
      tags: ["astro"],
      coverImage: "/media/2026/a.webp",
      updatedAt: "2026-10-11T00:00:00.000Z",
      version: 2,
      status: "draft",
    });
  });

  it("throws VERSION_CONFLICT when the client version is stale", () => {
    expect(() => applyUpdate(draft({ version: 3 }), input, NOW)).toThrowError(
      expect.objectContaining({ code: "VERSION_CONFLICT" }),
    );
  });
});

describe("publish", () => {
  it("publishes immediately when no publishAt is given", () => {
    const next = publish(draft(), undefined, NOW);
    expect(next).toMatchObject({ status: "published", publishedAt: NOW, publishAt: null, version: 2 });
  });

  it("publishes immediately when publishAt is in the past", () => {
    expect(publish(draft(), "2026-10-09T00:00:00Z", NOW).status).toBe("published");
  });

  it("publishes immediately when publishAt is within 60 seconds", () => {
    expect(publish(draft(), "2026-10-10T00:00:59Z", NOW).status).toBe("published");
  });

  it("schedules when publishAt is further in the future, truncated to the second", () => {
    const next = publish(draft(), "2026-10-12T08:00:00.123Z", NOW);
    expect(next).toMatchObject({
      status: "scheduled",
      publishAt: "2026-10-12T08:00:00.000Z",
      publishedAt: null,
    });
  });

  it("allows rescheduling a scheduled post", () => {
    const scheduled = publish(draft(), "2026-10-12T08:00:00Z", NOW);
    const moved = publish(scheduled, "2026-10-13T08:00:00Z", NOW);
    expect(moved.publishAt).toBe("2026-10-13T08:00:00.000Z");
  });

  it("refuses to publish an already published post", () => {
    const published = publish(draft(), undefined, NOW);
    expect(() => publish(published, undefined, NOW)).toThrowError(
      expect.objectContaining({ code: "INVALID_STATE" }),
    );
  });

  it("keeps the original publishedAt when republishing after an unpublish", () => {
    const first = publish(draft(), undefined, NOW);
    const back = unpublish(first, "2026-10-11T00:00:00.000Z");
    const again = publish(back, undefined, "2026-10-12T00:00:00.000Z");
    expect(again.publishedAt).toBe(NOW);
  });
});

describe("unpublish", () => {
  it("moves a scheduled post back to draft and clears publishAt", () => {
    const scheduled = publish(draft(), "2026-10-12T08:00:00Z", NOW);
    expect(unpublish(scheduled, NOW)).toMatchObject({ status: "draft", publishAt: null });
  });

  it("refuses to unpublish a draft", () => {
    expect(() => unpublish(draft(), NOW)).toThrowError(
      expect.objectContaining({ code: "INVALID_STATE" }),
    );
  });
});

describe("publishScheduled", () => {
  const scheduled = publish(draft(), "2026-10-12T08:00:00Z", NOW);

  it("publishes when the event matches the stored publishAt", () => {
    const next = publishScheduled(scheduled, "2026-10-12T08:00:00.000Z", "2026-10-12T08:00:01.000Z");
    expect(next).toMatchObject({
      status: "published",
      publishAt: null,
      publishedAt: "2026-10-12T08:00:00.000Z",
    });
  });

  it("ignores an event for a different time (post was rescheduled)", () => {
    expect(publishScheduled(scheduled, "2026-10-11T08:00:00.000Z", NOW)).toBeNull();
  });

  it("ignores an event when the post is no longer scheduled", () => {
    const back = unpublish(scheduled, NOW);
    expect(publishScheduled(back, "2026-10-12T08:00:00.000Z", NOW)).toBeNull();
  });
});

describe("needsRebuild", () => {
  const published = publish(draft(), undefined, NOW);
  const scheduled = publish(draft(), "2026-10-12T08:00:00Z", NOW);

  it.each([
    ["draft edit", draft(), draft({ title: "x" }), false],
    ["scheduled edit", scheduled, { ...scheduled, title: "x" }, false],
    ["publish", draft(), published, true],
    ["published edit", published, { ...published, title: "x" }, true],
    ["unpublish", published, draft(), true],
    ["delete published", published, null, true],
    ["delete draft", draft(), null, false],
  ] as const)("%s -> %s", (_name, before, after, expected) => {
    expect(needsRebuild(before, after)).toBe(expected);
  });
});

describe("toSummary", () => {
  it("drops the content field", () => {
    expect(toSummary(draft())).not.toHaveProperty("content");
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `pnpm --filter @blog/api test -- post`
Expected: FAIL — không resolve được `../../src/domain/post`.

- [ ] **Step 3: Viết mã**

`services/api/src/domain/post.ts`:
```ts
import type { CreatePostInput, Post, PostSummary, UpdatePostInput } from "@blog/shared";
import { DomainError } from "./errors";
import { isValidSlug, normalizeTags, slugify } from "./slug";

/** Schedules closer than this are published immediately instead. */
export const SCHEDULE_MIN_LEAD_MS = 60_000;

function resolveSlug(requested: string, title: string, id: string): string {
  if (requested.trim() !== "") {
    const slug = slugify(requested);
    if (!isValidSlug(slug)) {
      throw new DomainError("VALIDATION_ERROR", "slug must contain at least one latin letter or digit");
    }
    return slug;
  }
  const fromTitle = slugify(title);
  return fromTitle !== "" ? fromTitle : id.toLowerCase();
}

function truncateToSecond(iso: string): string {
  const ms = Date.parse(iso);
  return new Date(ms - (ms % 1000)).toISOString();
}

export function newPost(input: CreatePostInput, ctx: { id: string; now: string }): Post {
  return {
    id: ctx.id,
    slug: resolveSlug(input.slug ?? "", input.title, ctx.id),
    title: input.title,
    excerpt: input.excerpt,
    content: input.content,
    tags: normalizeTags(input.tags),
    coverImage: input.coverImage,
    status: "draft",
    publishAt: null,
    publishedAt: null,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    version: 1,
  };
}

export function applyUpdate(post: Post, input: UpdatePostInput, now: string): Post {
  if (input.version !== post.version) {
    throw new DomainError(
      "VERSION_CONFLICT",
      `post was modified elsewhere (current version ${post.version})`,
    );
  }
  return {
    ...post,
    title: input.title,
    slug: resolveSlug(input.slug, input.title, post.id),
    excerpt: input.excerpt,
    content: input.content,
    tags: normalizeTags(input.tags),
    coverImage: input.coverImage,
    updatedAt: now,
    version: post.version + 1,
  };
}

export function publish(post: Post, publishAt: string | undefined, now: string): Post {
  if (post.status === "published") {
    throw new DomainError("INVALID_STATE", "post is already published");
  }
  const bumped = { ...post, updatedAt: now, version: post.version + 1 };
  if (publishAt !== undefined) {
    const at = truncateToSecond(publishAt);
    if (Date.parse(at) - Date.parse(now) > SCHEDULE_MIN_LEAD_MS) {
      return { ...bumped, status: "scheduled", publishAt: at };
    }
  }
  return { ...bumped, status: "published", publishAt: null, publishedAt: post.publishedAt ?? now };
}

export function unpublish(post: Post, now: string): Post {
  if (post.status === "draft") {
    throw new DomainError("INVALID_STATE", "post is not published or scheduled");
  }
  return { ...post, status: "draft", publishAt: null, updatedAt: now, version: post.version + 1 };
}

/** Returns null when the scheduled event is stale (post rescheduled, unpublished or published). */
export function publishScheduled(post: Post, scheduledFor: string, now: string): Post | null {
  if (post.status !== "scheduled" || post.publishAt !== scheduledFor) return null;
  return {
    ...post,
    status: "published",
    publishAt: null,
    publishedAt: post.publishedAt ?? scheduledFor,
    updatedAt: now,
    version: post.version + 1,
  };
}

/** The public site only changes when a published post is involved before or after the change. */
export function needsRebuild(before: Post | null, after: Post | null): boolean {
  return before?.status === "published" || after?.status === "published";
}

export function toSummary(post: Post): PostSummary {
  const { content: _content, ...summary } = post;
  return summary;
}
```

- [ ] **Step 4: Chạy test để thấy thành công**

Run: `pnpm --filter @blog/api test`
Expected: PASS (cả test của Task 2 và Task 3).

- [ ] **Step 5: Lint + typecheck rồi commit**

```bash
pnpm format && pnpm lint && pnpm typecheck
git add services/api
git commit -m "feat(api): add pure post lifecycle domain" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Port, adapter giả và use case CRUD + build

**Files:**
- Create: `services/api/src/usecases/ports.ts`, `services/api/src/usecases/builds.ts`, `services/api/src/usecases/posts.ts`
- Create: `services/api/test/fakes.ts`
- Test: `services/api/test/usecases/builds.test.ts`, `services/api/test/usecases/posts.test.ts`

**Interfaces:**
- Consumes: Task 1–3.
- Produces:
  - Ports (`usecases/ports.ts`):
    ```ts
    interface PostRepository { get(id): Promise<Post | null>; list(): Promise<Post[]>; create(post): Promise<void>; update(next: Post, prev: Post): Promise<void>; delete(post): Promise<void> }
    interface BuildStatusRepository { get(): Promise<BuildState>; setQueued(now: string): Promise<void>; setFailed(now: string, error: string): Promise<void> }
    interface BuildQueue { enqueue(reason: string): Promise<void> }
    interface PublishScheduler { schedule(postId: string, publishAt: string): Promise<void>; cancel(postId: string): Promise<void> }
    interface UploadSigner { sign(key: string, contentType: ImageContentType): Promise<{ url: string; fields: Record<string, string> }> }
    interface Deps { posts; builds; buildQueue; scheduler; uploads; now: () => string; newId: () => string; blogBaseUrl: string }
    ```
    Hợp đồng: `create` ném `SLUG_TAKEN`; `update` ném `VERSION_CONFLICT` nếu bản lưu có `version !== prev.version`, ném `SLUG_TAKEN` nếu slug mới đã bị bài khác dùng; `list` trả bài mới sửa nhất trước.
  - `requestBuild(deps, reason): Promise<void>`, `getLatestBuild(deps): Promise<BuildState>`, `triggerBuild(deps): Promise<void>`
  - `listPosts(deps): Promise<PostSummary[]>`, `getPost(deps, id): Promise<Post>`, `createPost(deps, input: CreatePostInput): Promise<Post>`, `updatePost(deps, id, input: UpdatePostInput): Promise<Post>`, `deletePost(deps, id): Promise<void>`
  - `test/fakes.ts`: `makeDeps(): TestDeps` (Task 5, 8 dùng lại)

- [ ] **Step 1: Viết ports**

`services/api/src/usecases/ports.ts`:
```ts
import type { BuildState, ImageContentType, Post } from "@blog/shared";

export interface PostRepository {
  get(id: string): Promise<Post | null>;
  /** Newest `updatedAt` first. */
  list(): Promise<Post[]>;
  /** Throws DomainError SLUG_TAKEN when the slug is used by another post. */
  create(post: Post): Promise<void>;
  /** Throws VERSION_CONFLICT when the stored version is not `prev.version`, SLUG_TAKEN on slug clash. */
  update(next: Post, prev: Post): Promise<void>;
  delete(post: Post): Promise<void>;
}

export interface BuildStatusRepository {
  get(): Promise<BuildState>;
  setQueued(now: string): Promise<void>;
  setFailed(now: string, error: string): Promise<void>;
}

export interface BuildQueue {
  enqueue(reason: string): Promise<void>;
}

export interface PublishScheduler {
  /** Creates or replaces the one-time schedule for the post. */
  schedule(postId: string, publishAt: string): Promise<void>;
  /** Removes the schedule; succeeds when it does not exist. */
  cancel(postId: string): Promise<void>;
}

export interface UploadSigner {
  sign(
    key: string,
    contentType: ImageContentType,
  ): Promise<{ url: string; fields: Record<string, string> }>;
}

export interface Deps {
  posts: PostRepository;
  builds: BuildStatusRepository;
  buildQueue: BuildQueue;
  scheduler: PublishScheduler;
  uploads: UploadSigner;
  now: () => string;
  newId: () => string;
  /** e.g. "https://blog.oki-dev.xyz", no trailing slash */
  blogBaseUrl: string;
}
```

- [ ] **Step 2: Viết adapter giả cho test**

`services/api/test/fakes.ts`:
```ts
import type { BuildState, ImageContentType, Post } from "@blog/shared";
import { DomainError } from "../src/domain/errors";
import type {
  BuildQueue,
  BuildStatusRepository,
  Deps,
  PostRepository,
  PublishScheduler,
  UploadSigner,
} from "../src/usecases/ports";

export class InMemoryPostRepository implements PostRepository {
  readonly items = new Map<string, Post>();

  async get(id: string) {
    const post = this.items.get(id);
    return post ? structuredClone(post) : null;
  }

  async list() {
    return [...this.items.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((p) => structuredClone(p));
  }

  async create(post: Post) {
    this.assertSlugFree(post.slug, post.id);
    this.items.set(post.id, structuredClone(post));
  }

  async update(next: Post, prev: Post) {
    const current = this.items.get(prev.id);
    if (!current || current.version !== prev.version) {
      throw new DomainError("VERSION_CONFLICT", "post was modified elsewhere");
    }
    this.assertSlugFree(next.slug, next.id);
    this.items.set(next.id, structuredClone(next));
  }

  async delete(post: Post) {
    this.items.delete(post.id);
  }

  private assertSlugFree(slug: string, ownerId: string) {
    for (const p of this.items.values()) {
      if (p.slug === slug && p.id !== ownerId) {
        throw new DomainError("SLUG_TAKEN", `slug "${slug}" is already used`);
      }
    }
  }
}

export class FakeBuildStatusRepository implements BuildStatusRepository {
  state: BuildState = { status: "idle", updatedAt: null, error: null };

  async get() {
    return { ...this.state };
  }

  async setQueued(now: string) {
    this.state = { status: "queued", updatedAt: now, error: null };
  }

  async setFailed(now: string, error: string) {
    this.state = { status: "failed", updatedAt: now, error };
  }
}

export class RecordingBuildQueue implements BuildQueue {
  readonly reasons: string[] = [];
  failWith: Error | null = null;

  async enqueue(reason: string) {
    if (this.failWith) throw this.failWith;
    this.reasons.push(reason);
  }
}

export class RecordingScheduler implements PublishScheduler {
  readonly scheduled = new Map<string, string>();
  readonly cancelled: string[] = [];
  failWith: Error | null = null;

  async schedule(postId: string, publishAt: string) {
    if (this.failWith) throw this.failWith;
    this.scheduled.set(postId, publishAt);
  }

  async cancel(postId: string) {
    this.scheduled.delete(postId);
    this.cancelled.push(postId);
  }
}

export class FakeUploadSigner implements UploadSigner {
  async sign(key: string, contentType: ImageContentType) {
    return { url: "https://uploads.example", fields: { key, "Content-Type": contentType } };
  }
}

export interface TestDeps extends Deps {
  posts: InMemoryPostRepository;
  builds: FakeBuildStatusRepository;
  buildQueue: RecordingBuildQueue;
  scheduler: RecordingScheduler;
  /** Change to move the fake clock. */
  clock: { now: string };
}

export function makeDeps(): TestDeps {
  let seq = 0;
  const clock = { now: "2026-10-10T00:00:00.000Z" };
  return {
    posts: new InMemoryPostRepository(),
    builds: new FakeBuildStatusRepository(),
    buildQueue: new RecordingBuildQueue(),
    scheduler: new RecordingScheduler(),
    uploads: new FakeUploadSigner(),
    clock,
    now: () => clock.now,
    newId: () => `01J${String(++seq).padStart(23, "0")}`,
    blogBaseUrl: "https://blog.oki-dev.xyz",
  };
}
```

- [ ] **Step 3: Viết test thất bại cho use case**

`services/api/test/usecases/builds.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { getLatestBuild, requestBuild } from "../../src/usecases/builds";
import { makeDeps } from "../fakes";

describe("requestBuild", () => {
  it("marks the build as queued and enqueues a message", async () => {
    const deps = makeDeps();
    await requestBuild(deps, "manual");
    expect(deps.buildQueue.reasons).toEqual(["manual"]);
    expect(await getLatestBuild(deps)).toEqual({
      status: "queued",
      updatedAt: deps.clock.now,
      error: null,
    });
  });

  it("marks the build as failed and rethrows when the queue is unavailable", async () => {
    const deps = makeDeps();
    deps.buildQueue.failWith = new Error("SQS down");
    await expect(requestBuild(deps, "manual")).rejects.toThrow("SQS down");
    expect(deps.builds.state).toMatchObject({
      status: "failed",
      error: "could not enqueue build: SQS down",
    });
  });
});
```

`services/api/test/usecases/posts.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  createPost,
  deletePost,
  getPost,
  listPosts,
  updatePost,
} from "../../src/usecases/posts";
import { publishPost } from "../../src/usecases/publishing";
import { makeDeps } from "../fakes";

const create = (deps: ReturnType<typeof makeDeps>, title = "Học AWS") =>
  createPost(deps, { title, excerpt: "", content: "body", tags: [], coverImage: null });

const editInput = (version: number) => ({
  title: "Học AWS (sửa)",
  slug: "hoc-aws",
  excerpt: "",
  content: "new body",
  tags: [],
  coverImage: null,
  version,
});

describe("createPost / getPost", () => {
  it("stores a draft that can be read back", async () => {
    const deps = makeDeps();
    const created = await create(deps);
    expect(await getPost(deps, created.id)).toEqual(created);
    expect(created.status).toBe("draft");
  });

  it("rejects a second post with the same slug", async () => {
    const deps = makeDeps();
    await create(deps);
    await expect(create(deps)).rejects.toMatchObject({ code: "SLUG_TAKEN" });
  });

  it("throws NOT_FOUND for an unknown id", async () => {
    await expect(getPost(makeDeps(), "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("listPosts", () => {
  it("returns summaries without content, newest update first", async () => {
    const deps = makeDeps();
    const first = await create(deps, "First");
    deps.clock.now = "2026-10-11T00:00:00.000Z";
    const second = await create(deps, "Second");
    const list = await listPosts(deps);
    expect(list.map((p) => p.id)).toEqual([second.id, first.id]);
    expect(list[0]).not.toHaveProperty("content");
  });
});

describe("updatePost", () => {
  it("saves a draft without requesting a build", async () => {
    const deps = makeDeps();
    const post = await create(deps);
    const updated = await updatePost(deps, post.id, editInput(1));
    expect(updated.version).toBe(2);
    expect(deps.buildQueue.reasons).toEqual([]);
  });

  it("requests a build when a published post changes", async () => {
    const deps = makeDeps();
    const post = await create(deps);
    const published = await publishPost(deps, post.id, {});
    deps.buildQueue.reasons.length = 0;
    await updatePost(deps, post.id, editInput(published.version));
    expect(deps.buildQueue.reasons).toEqual([`update:${post.id}`]);
  });

  it("rejects a stale version", async () => {
    const deps = makeDeps();
    const post = await create(deps);
    await updatePost(deps, post.id, editInput(1));
    await expect(updatePost(deps, post.id, editInput(1))).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });
  });
});

describe("deletePost", () => {
  it("deletes a draft without a build", async () => {
    const deps = makeDeps();
    const post = await create(deps);
    await deletePost(deps, post.id);
    await expect(getPost(deps, post.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(deps.buildQueue.reasons).toEqual([]);
  });

  it("cancels the schedule of a scheduled post", async () => {
    const deps = makeDeps();
    const post = await create(deps);
    await publishPost(deps, post.id, { publishAt: "2026-10-12T08:00:00Z" });
    await deletePost(deps, post.id);
    expect(deps.scheduler.cancelled).toEqual([post.id]);
    expect(deps.buildQueue.reasons).toEqual([]);
  });

  it("requests a build when deleting a published post", async () => {
    const deps = makeDeps();
    const post = await create(deps);
    await publishPost(deps, post.id, {});
    deps.buildQueue.reasons.length = 0;
    await deletePost(deps, post.id);
    expect(deps.buildQueue.reasons).toEqual([`delete:${post.id}`]);
  });
});
```

> Ghi chú: `posts.test.ts` dùng `publishPost` của Task 5 để tạo bài đã đăng. Ở task này test sẽ còn fail ở import `publishing` cho tới Step 5 — đó là chủ ý; Step 5 thêm bản tối thiểu của `publishPost`, Task 5 hoàn thiện và test đầy đủ.

- [ ] **Step 4: Chạy test để thấy thất bại**

Run: `pnpm --filter @blog/api test -- usecases`
Expected: FAIL — không resolve được `../../src/usecases/builds`.

- [ ] **Step 5: Viết mã**

`services/api/src/usecases/builds.ts`:
```ts
import type { BuildState } from "@blog/shared";
import type { Deps } from "./ports";

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export async function requestBuild(deps: Deps, reason: string): Promise<void> {
  const now = deps.now();
  await deps.builds.setQueued(now);
  try {
    await deps.buildQueue.enqueue(reason);
  } catch (err) {
    await deps.builds.setFailed(now, `could not enqueue build: ${messageOf(err)}`);
    throw err;
  }
}

export const getLatestBuild = (deps: Deps): Promise<BuildState> => deps.builds.get();

export const triggerBuild = (deps: Deps): Promise<void> => requestBuild(deps, "manual");
```

`services/api/src/usecases/posts.ts`:
```ts
import type { CreatePostInput, Post, PostSummary, UpdatePostInput } from "@blog/shared";
import { notFound } from "../domain/errors";
import { applyUpdate, needsRebuild, newPost, toSummary } from "../domain/post";
import { requestBuild } from "./builds";
import type { Deps } from "./ports";

export async function listPosts(deps: Deps): Promise<PostSummary[]> {
  return (await deps.posts.list()).map(toSummary);
}

export async function getPost(deps: Deps, id: string): Promise<Post> {
  const post = await deps.posts.get(id);
  if (!post) throw notFound("post");
  return post;
}

export async function createPost(deps: Deps, input: CreatePostInput): Promise<Post> {
  const post = newPost(input, { id: deps.newId(), now: deps.now() });
  await deps.posts.create(post);
  return post;
}

export async function updatePost(deps: Deps, id: string, input: UpdatePostInput): Promise<Post> {
  const prev = await getPost(deps, id);
  const next = applyUpdate(prev, input, deps.now());
  await deps.posts.update(next, prev);
  if (needsRebuild(prev, next)) await requestBuild(deps, `update:${id}`);
  return next;
}

export async function deletePost(deps: Deps, id: string): Promise<void> {
  const prev = await getPost(deps, id);
  // Delete first: if cancelling then fails, the orphan schedule finds no post and is skipped.
  await deps.posts.delete(prev);
  if (prev.status === "scheduled") await deps.scheduler.cancel(id);
  if (needsRebuild(prev, null)) await requestBuild(deps, `delete:${id}`);
}
```

`services/api/src/usecases/publishing.ts` (bản tối thiểu, Task 5 thay thế toàn bộ):
```ts
import type { Post, PublishInput } from "@blog/shared";
import { publish } from "../domain/post";
import { requestBuild } from "./builds";
import type { Deps } from "./ports";
import { getPost } from "./posts";

export async function publishPost(deps: Deps, id: string, input: PublishInput): Promise<Post> {
  const prev = await getPost(deps, id);
  const next = publish(prev, input.publishAt, deps.now());
  await deps.posts.update(next, prev);
  if (next.status === "scheduled" && next.publishAt) {
    await deps.scheduler.schedule(id, next.publishAt);
  } else {
    await requestBuild(deps, `publish:${id}`);
  }
  return next;
}
```

- [ ] **Step 6: Chạy test để thấy thành công**

Run: `pnpm --filter @blog/api test`
Expected: PASS.

- [ ] **Step 7: Lint + typecheck rồi commit**

```bash
pnpm format && pnpm lint && pnpm typecheck
git add services/api
git commit -m "feat(api): add ports, in-memory fakes and CRUD/build use cases" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Use case publish, gỡ bài, đăng theo lịch, upload

**Files:**
- Modify: `services/api/src/usecases/publishing.ts` (thay toàn bộ)
- Create: `services/api/src/usecases/uploads.ts`, `services/api/src/events.ts`
- Test: `services/api/test/usecases/publishing.test.ts`, `services/api/test/usecases/uploads.test.ts`

**Interfaces:**
- Consumes: Task 1–4.
- Produces:
  - `publishPost(deps, id, input: PublishInput): Promise<Post>`
  - `unpublishPost(deps, id): Promise<Post>`
  - `runScheduledPublish(deps, event: { postId: string; publishAt: string }): Promise<"published" | "skipped">`
  - `createUpload(deps, input: CreateUploadInput, opts: { e2e: boolean }): Promise<UploadTicket>`
  - `events.ts`: `scheduledPublishEventSchema`, `type ScheduledPublishEvent = { type: "scheduled-publish"; postId: string; publishAt: string }`, `isScheduledPublishEvent(event: unknown): boolean`

- [ ] **Step 1: Viết test thất bại**

`services/api/test/usecases/publishing.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createPost, getPost } from "../../src/usecases/posts";
import { publishPost, runScheduledPublish, unpublishPost } from "../../src/usecases/publishing";
import { makeDeps } from "../fakes";

const setup = async () => {
  const deps = makeDeps();
  const post = await createPost(deps, {
    title: "Học AWS",
    excerpt: "",
    content: "",
    tags: [],
    coverImage: null,
  });
  return { deps, post };
};

describe("publishPost", () => {
  it("publishes now and requests a build", async () => {
    const { deps, post } = await setup();
    const next = await publishPost(deps, post.id, {});
    expect(next.status).toBe("published");
    expect(deps.buildQueue.reasons).toEqual([`publish:${post.id}`]);
    expect(deps.scheduler.scheduled.size).toBe(0);
  });

  it("schedules a future post without building", async () => {
    const { deps, post } = await setup();
    const next = await publishPost(deps, post.id, { publishAt: "2026-10-12T08:00:00Z" });
    expect(next.status).toBe("scheduled");
    expect(deps.scheduler.scheduled.get(post.id)).toBe("2026-10-12T08:00:00.000Z");
    expect(deps.buildQueue.reasons).toEqual([]);
  });

  it("cancels the schedule when a scheduled post is published now", async () => {
    const { deps, post } = await setup();
    await publishPost(deps, post.id, { publishAt: "2026-10-12T08:00:00Z" });
    await publishPost(deps, post.id, {});
    expect(deps.scheduler.cancelled).toEqual([post.id]);
    expect(deps.buildQueue.reasons).toEqual([`publish:${post.id}`]);
  });

  it("reverts the post when the schedule cannot be created", async () => {
    const { deps, post } = await setup();
    deps.scheduler.failWith = new Error("Scheduler down");
    await expect(
      publishPost(deps, post.id, { publishAt: "2026-10-12T08:00:00Z" }),
    ).rejects.toThrow("Scheduler down");
    const stored = await getPost(deps, post.id);
    expect(stored.status).toBe("draft");
    expect(stored.publishAt).toBeNull();
  });
});

describe("unpublishPost", () => {
  it("takes a published post down and requests a build", async () => {
    const { deps, post } = await setup();
    await publishPost(deps, post.id, {});
    deps.buildQueue.reasons.length = 0;
    const next = await unpublishPost(deps, post.id);
    expect(next.status).toBe("draft");
    expect(deps.buildQueue.reasons).toEqual([`unpublish:${post.id}`]);
  });

  it("cancels a schedule without building", async () => {
    const { deps, post } = await setup();
    await publishPost(deps, post.id, { publishAt: "2026-10-12T08:00:00Z" });
    await unpublishPost(deps, post.id);
    expect(deps.scheduler.cancelled).toEqual([post.id]);
    expect(deps.buildQueue.reasons).toEqual([]);
  });
});

describe("runScheduledPublish", () => {
  it("publishes when the event matches and requests a build", async () => {
    const { deps, post } = await setup();
    await publishPost(deps, post.id, { publishAt: "2026-10-12T08:00:00Z" });
    deps.clock.now = "2026-10-12T08:00:01.000Z";
    const result = await runScheduledPublish(deps, {
      postId: post.id,
      publishAt: "2026-10-12T08:00:00.000Z",
    });
    expect(result).toBe("published");
    expect((await getPost(deps, post.id)).status).toBe("published");
    expect(deps.buildQueue.reasons).toEqual([`scheduled:${post.id}`]);
  });

  it("skips a stale event after the post was rescheduled", async () => {
    const { deps, post } = await setup();
    await publishPost(deps, post.id, { publishAt: "2026-10-12T08:00:00Z" });
    await publishPost(deps, post.id, { publishAt: "2026-10-13T08:00:00Z" });
    const result = await runScheduledPublish(deps, {
      postId: post.id,
      publishAt: "2026-10-12T08:00:00.000Z",
    });
    expect(result).toBe("skipped");
    expect(deps.buildQueue.reasons).toEqual([]);
  });

  it("skips when the post was deleted", async () => {
    const deps = makeDeps();
    const result = await runScheduledPublish(deps, {
      postId: "gone",
      publishAt: "2026-10-12T08:00:00.000Z",
    });
    expect(result).toBe("skipped");
  });
});
```

`services/api/test/usecases/uploads.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createUpload } from "../../src/usecases/uploads";
import { makeDeps } from "../fakes";

describe("createUpload", () => {
  it("puts uploads under media/<year>/ with a lowercase ulid and the right extension", async () => {
    const deps = makeDeps();
    const ticket = await createUpload(deps, { contentType: "image/webp" }, { e2e: false });
    expect(ticket.key).toMatch(/^media\/2026\/01j0+1\.webp$/);
    expect(ticket.publicUrl).toBe(`https://blog.oki-dev.xyz/${ticket.key}`);
    expect(ticket.fields["Content-Type"]).toBe("image/webp");
  });

  it("puts e2e uploads under media/e2e/", async () => {
    const deps = makeDeps();
    const ticket = await createUpload(deps, { contentType: "image/png" }, { e2e: true });
    expect(ticket.key).toMatch(/^media\/e2e\/[0-9a-z]+\.png$/);
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `pnpm --filter @blog/api test -- publishing uploads`
Expected: FAIL — `unpublishPost`/`runScheduledPublish` không được export; không resolve được `uploads`.

- [ ] **Step 3: Viết mã**

`services/api/src/events.ts`:
```ts
import { z } from "zod";

export const scheduledPublishEventSchema = z.object({
  type: z.literal("scheduled-publish"),
  postId: z.string().min(1),
  publishAt: z.iso.datetime(),
});
export type ScheduledPublishEvent = z.infer<typeof scheduledPublishEventSchema>;

export function isScheduledPublishEvent(event: unknown): boolean {
  return (
    typeof event === "object" &&
    event !== null &&
    (event as { type?: unknown }).type === "scheduled-publish"
  );
}
```

`services/api/src/usecases/publishing.ts` (thay toàn bộ file):
```ts
import type { Post, PublishInput } from "@blog/shared";
import { needsRebuild, publish, publishScheduled, unpublish } from "../domain/post";
import { requestBuild } from "./builds";
import type { Deps } from "./ports";
import { getPost } from "./posts";

export async function publishPost(deps: Deps, id: string, input: PublishInput): Promise<Post> {
  const prev = await getPost(deps, id);
  const next = publish(prev, input.publishAt, deps.now());
  await deps.posts.update(next, prev);

  if (next.status === "scheduled" && next.publishAt) {
    try {
      await deps.scheduler.schedule(id, next.publishAt);
    } catch (err) {
      // Do not leave a "scheduled" post without a schedule: restore the previous state.
      await deps.posts
        .update({ ...prev, updatedAt: deps.now(), version: next.version + 1 }, next)
        .catch(() => undefined);
      throw err;
    }
    return next;
  }

  if (prev.status === "scheduled") await deps.scheduler.cancel(id);
  await requestBuild(deps, `publish:${id}`);
  return next;
}

export async function unpublishPost(deps: Deps, id: string): Promise<Post> {
  const prev = await getPost(deps, id);
  const next = unpublish(prev, deps.now());
  await deps.posts.update(next, prev);
  // If cancelling fails, the stale schedule is skipped by runScheduledPublish.
  if (prev.status === "scheduled") await deps.scheduler.cancel(id);
  if (needsRebuild(prev, next)) await requestBuild(deps, `unpublish:${id}`);
  return next;
}

/** Called by EventBridge Scheduler. Throwing makes Scheduler retry (e.g. on VERSION_CONFLICT). */
export async function runScheduledPublish(
  deps: Deps,
  event: { postId: string; publishAt: string },
): Promise<"published" | "skipped"> {
  const prev = await deps.posts.get(event.postId);
  if (!prev) return "skipped";
  const next = publishScheduled(prev, event.publishAt, deps.now());
  if (!next) return "skipped";
  await deps.posts.update(next, prev);
  await requestBuild(deps, `scheduled:${event.postId}`);
  return "published";
}
```

`services/api/src/usecases/uploads.ts`:
```ts
import { type CreateUploadInput, IMAGE_EXTENSIONS, type UploadTicket } from "@blog/shared";
import type { Deps } from "./ports";

export async function createUpload(
  deps: Deps,
  input: CreateUploadInput,
  opts: { e2e: boolean },
): Promise<UploadTicket> {
  const year = new Date(deps.now()).getUTCFullYear();
  const prefix = opts.e2e ? "media/e2e" : `media/${year}`;
  const key = `${prefix}/${deps.newId().toLowerCase()}.${IMAGE_EXTENSIONS[input.contentType]}`;
  const signed = await deps.uploads.sign(key, input.contentType);
  return { ...signed, key, publicUrl: `${deps.blogBaseUrl}/${key}` };
}
```

- [ ] **Step 4: Chạy test để thấy thành công**

Run: `pnpm --filter @blog/api test`
Expected: PASS (toàn bộ test, gồm `posts.test.ts` của Task 4).

- [ ] **Step 5: Lint + typecheck rồi commit**

```bash
pnpm format && pnpm lint && pnpm typecheck
git add services/api
git commit -m "feat(api): add publish, unpublish, scheduled publish and upload use cases" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Adapter DynamoDB cho bài viết

**Files:**
- Create: `services/api/src/adapters/dynamo/items.ts`, `services/api/src/adapters/dynamo/postRepo.ts`
- Create: `services/api/test/fixtures.ts`
- Test: `services/api/test/adapters/postRepo.test.ts`

**Interfaces:**
- Consumes: `PostRepository` (Task 4), `DomainError` (Task 2).
- Produces:
  - `postKey(id)`, `slugKey(slug)`, `BUILD_KEY`, `POSTS_INDEX = "byUpdated"`, `toPostItem(post)`, `fromPostItem(item): Post`
  - `class DynamoPostRepository implements PostRepository { constructor(db: DynamoDBDocumentClient, tableName: string) }`
  - `test/fixtures.ts`: `samplePost(overrides?: Partial<Post>): Post`

- [ ] **Step 1: Viết fixture và test thất bại**

`services/api/test/fixtures.ts`:
```ts
import type { Post } from "@blog/shared";

export const samplePost = (overrides: Partial<Post> = {}): Post => ({
  id: "01JABCDEFGHJKMNPQRSTVWXYZ0",
  slug: "hoc-aws",
  title: "Học AWS",
  excerpt: "",
  content: "# Hi",
  tags: ["aws"],
  coverImage: null,
  status: "draft",
  publishAt: null,
  publishedAt: null,
  createdAt: "2026-10-10T00:00:00.000Z",
  updatedAt: "2026-10-10T00:00:00.000Z",
  version: 1,
  ...overrides,
});
```

`services/api/test/adapters/postRepo.test.ts`:
```ts
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
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `pnpm --filter @blog/api test -- postRepo`
Expected: FAIL — không resolve được `../../src/adapters/dynamo/items`.

- [ ] **Step 3: Viết mã**

`services/api/src/adapters/dynamo/items.ts`:
```ts
import type { Post } from "@blog/shared";

export const POSTS_INDEX = "byUpdated";
export const postKey = (id: string) => ({ PK: `POST#${id}`, SK: "POST" });
export const slugKey = (slug: string) => ({ PK: `SLUG#${slug}`, SK: "SLUG" });
export const BUILD_KEY = { PK: "BUILD", SK: "LATEST" } as const;

export function toPostItem(post: Post): Record<string, unknown> {
  return { ...postKey(post.id), GSI1PK: "POST", GSI1SK: post.updatedAt, ...post };
}

export function fromPostItem(item: Record<string, unknown>): Post {
  const { PK: _pk, SK: _sk, GSI1PK: _gpk, GSI1SK: _gsk, ...post } = item;
  return post as unknown as Post;
}
```

`services/api/src/adapters/dynamo/postRepo.ts`:
```ts
import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
} from "@aws-sdk/client-dynamodb";
import {
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Post } from "@blog/shared";
import { DomainError } from "../../domain/errors";
import type { PostRepository } from "../../usecases/ports";
import { fromPostItem, POSTS_INDEX, postKey, slugKey, toPostItem } from "./items";

const versionConflict = () =>
  new DomainError("VERSION_CONFLICT", "post was modified elsewhere, reload and try again");
const slugTaken = (slug: string) =>
  new DomainError("SLUG_TAKEN", `slug "${slug}" is already used by another post`);

const failedAt = (err: TransactionCanceledException, index: number) =>
  err.CancellationReasons?.[index]?.Code === "ConditionalCheckFailed";

export class DynamoPostRepository implements PostRepository {
  private readonly db: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(db: DynamoDBDocumentClient, tableName: string) {
    this.db = db;
    this.tableName = tableName;
  }

  async get(id: string): Promise<Post | null> {
    const res = await this.db.send(new GetCommand({ TableName: this.tableName, Key: postKey(id) }));
    return res.Item ? fromPostItem(res.Item) : null;
  }

  async list(): Promise<Post[]> {
    const posts: Post[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const res = await this.db.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: POSTS_INDEX,
          KeyConditionExpression: "GSI1PK = :pk",
          ExpressionAttributeValues: { ":pk": "POST" },
          ScanIndexForward: false,
          ExclusiveStartKey: startKey,
        }),
      );
      posts.push(...(res.Items ?? []).map(fromPostItem));
      startKey = res.LastEvaluatedKey;
    } while (startKey);
    return posts;
  }

  async create(post: Post): Promise<void> {
    try {
      await this.db.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.tableName,
                Item: toPostItem(post),
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
            {
              Put: {
                TableName: this.tableName,
                Item: { ...slugKey(post.slug), postId: post.id },
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
          ],
        }),
      );
    } catch (err) {
      if (err instanceof TransactionCanceledException && failedAt(err, 1)) {
        throw slugTaken(post.slug);
      }
      throw err;
    }
  }

  async update(next: Post, prev: Post): Promise<void> {
    const putPost = {
      TableName: this.tableName,
      Item: toPostItem(next),
      ConditionExpression: "#v = :v",
      ExpressionAttributeNames: { "#v": "version" },
      ExpressionAttributeValues: { ":v": prev.version },
    };

    if (next.slug === prev.slug) {
      try {
        await this.db.send(new PutCommand(putPost));
      } catch (err) {
        if (err instanceof ConditionalCheckFailedException) throw versionConflict();
        throw err;
      }
      return;
    }

    try {
      await this.db.send(
        new TransactWriteCommand({
          TransactItems: [
            { Put: putPost },
            {
              Put: {
                TableName: this.tableName,
                Item: { ...slugKey(next.slug), postId: next.id },
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
            { Delete: { TableName: this.tableName, Key: slugKey(prev.slug) } },
          ],
        }),
      );
    } catch (err) {
      if (err instanceof TransactionCanceledException) {
        if (failedAt(err, 0)) throw versionConflict();
        if (failedAt(err, 1)) throw slugTaken(next.slug);
      }
      throw err;
    }
  }

  async delete(post: Post): Promise<void> {
    await this.db.send(
      new TransactWriteCommand({
        TransactItems: [
          { Delete: { TableName: this.tableName, Key: postKey(post.id) } },
          { Delete: { TableName: this.tableName, Key: slugKey(post.slug) } },
        ],
      }),
    );
  }
}
```

- [ ] **Step 4: Chạy test để thấy thành công**

Run: `pnpm --filter @blog/api test -- postRepo`
Expected: PASS.

- [ ] **Step 5: Lint + typecheck rồi commit**

```bash
pnpm format && pnpm lint && pnpm typecheck
git add services/api
git commit -m "feat(api): add DynamoDB post repository" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Adapter trạng thái build, SQS, EventBridge Scheduler, S3

**Files:**
- Create: `services/api/src/adapters/dynamo/buildStatusRepo.ts`
- Create: `services/api/src/adapters/sqs/buildQueue.ts`
- Create: `services/api/src/adapters/scheduler/publishScheduler.ts`
- Create: `services/api/src/adapters/s3/uploadSigner.ts`
- Test: `services/api/test/adapters/{buildStatusRepo,buildQueue,publishScheduler,uploadSigner}.test.ts`

**Interfaces:**
- Consumes: ports (Task 4), `BUILD_KEY` (Task 6), `ScheduledPublishEvent` (Task 5).
- Produces:
  - `class DynamoBuildStatusRepository implements BuildStatusRepository { constructor(db: DynamoDBDocumentClient, tableName: string) }`
  - `class SqsBuildQueue implements BuildQueue { constructor(sqs: SQSClient, queueUrl: string) }`
  - `interface SchedulerTarget { groupName: string; lambdaArn: string; roleArn: string }`, `scheduleName(postId)`, `atExpression(iso)`, `class EventBridgePublishScheduler implements PublishScheduler { constructor(client: SchedulerClient, target: SchedulerTarget) }`
  - `MAX_UPLOAD_BYTES = 10 * 1024 * 1024`, `UPLOAD_EXPIRES_SECONDS = 300`, `class S3UploadSigner implements UploadSigner { constructor(s3: S3Client, bucket: string) }`

- [ ] **Step 1: Viết test thất bại**

`services/api/test/adapters/buildStatusRepo.test.ts`:
```ts
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
```

`services/api/test/adapters/buildQueue.test.ts`:
```ts
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { SqsBuildQueue } from "../../src/adapters/sqs/buildQueue";

const sqs = mockClient(SQSClient);
const queue = new SqsBuildQueue(new SQSClient({ region: "ap-northeast-1" }), "https://sqs/q.fifo");

beforeEach(() => sqs.reset());

describe("SqsBuildQueue", () => {
  it("sends to the single 'site' group with a unique dedup id per request", async () => {
    sqs.on(SendMessageCommand).resolves({});
    await queue.enqueue("manual");
    await queue.enqueue("manual");
    const [a, b] = sqs.commandCalls(SendMessageCommand).map((c) => c.args[0].input);
    expect(a).toMatchObject({
      QueueUrl: "https://sqs/q.fifo",
      MessageGroupId: "site",
      MessageBody: JSON.stringify({ reason: "manual" }),
    });
    expect(a?.MessageDeduplicationId).toBeTruthy();
    expect(a?.MessageDeduplicationId).not.toBe(b?.MessageDeduplicationId);
  });
});
```

`services/api/test/adapters/publishScheduler.test.ts`:
```ts
import {
  ConflictException,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  ResourceNotFoundException,
  SchedulerClient,
  UpdateScheduleCommand,
} from "@aws-sdk/client-scheduler";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import {
  atExpression,
  EventBridgePublishScheduler,
} from "../../src/adapters/scheduler/publishScheduler";

const client = mockClient(SchedulerClient);
const scheduler = new EventBridgePublishScheduler(new SchedulerClient({ region: "ap-northeast-1" }), {
  groupName: "blog-publish",
  lambdaArn: "arn:aws:lambda:ap-northeast-1:111111111111:function:api",
  roleArn: "arn:aws:iam::111111111111:role/scheduler",
});

beforeEach(() => client.reset());

describe("atExpression", () => {
  it("formats a UTC ISO timestamp without milliseconds or zone", () => {
    expect(atExpression("2026-10-12T08:00:00.000Z")).toBe("at(2026-10-12T08:00:00)");
  });
});

describe("EventBridgePublishScheduler.schedule", () => {
  it("creates a one-time, self-deleting schedule that carries the publish event", async () => {
    client.on(CreateScheduleCommand).resolves({});
    await scheduler.schedule("P1", "2026-10-12T08:00:00.000Z");
    const input = client.commandCalls(CreateScheduleCommand)[0]?.args[0].input;
    expect(input).toMatchObject({
      Name: "post-P1",
      GroupName: "blog-publish",
      ScheduleExpression: "at(2026-10-12T08:00:00)",
      ScheduleExpressionTimezone: "UTC",
      FlexibleTimeWindow: { Mode: "OFF" },
      ActionAfterCompletion: "DELETE",
    });
    expect(JSON.parse(input?.Target?.Input ?? "{}")).toEqual({
      type: "scheduled-publish",
      postId: "P1",
      publishAt: "2026-10-12T08:00:00.000Z",
    });
  });

  it("updates the schedule when it already exists", async () => {
    client.on(CreateScheduleCommand).rejects(new ConflictException({ message: "exists", $metadata: {} }));
    client.on(UpdateScheduleCommand).resolves({});
    await scheduler.schedule("P1", "2026-10-13T08:00:00.000Z");
    expect(client.commandCalls(UpdateScheduleCommand)[0]?.args[0].input.ScheduleExpression).toBe(
      "at(2026-10-13T08:00:00)",
    );
  });
});

describe("EventBridgePublishScheduler.cancel", () => {
  it("deletes the schedule", async () => {
    client.on(DeleteScheduleCommand).resolves({});
    await scheduler.cancel("P1");
    expect(client.commandCalls(DeleteScheduleCommand)[0]?.args[0].input).toEqual({
      Name: "post-P1",
      GroupName: "blog-publish",
    });
  });

  it("succeeds when the schedule is already gone", async () => {
    client
      .on(DeleteScheduleCommand)
      .rejects(new ResourceNotFoundException({ message: "gone", $metadata: {} }));
    await expect(scheduler.cancel("P1")).resolves.toBeUndefined();
  });
});
```

`services/api/test/adapters/uploadSigner.test.ts`:
```ts
import { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, S3UploadSigner } from "../../src/adapters/s3/uploadSigner";

const signer = new S3UploadSigner(
  new S3Client({
    region: "ap-northeast-1",
    credentials: { accessKeyId: "AKIATEST", secretAccessKey: "secret" },
  }),
  "blog-media",
);

describe("S3UploadSigner", () => {
  it("signs a POST policy that pins the key, content type and size range", async () => {
    const { url, fields } = await signer.sign("media/2026/abc.webp", "image/webp");
    expect(url).toContain("blog-media");
    expect(fields.key).toBe("media/2026/abc.webp");
    expect(fields["Content-Type"]).toBe("image/webp");
    const policy = JSON.parse(Buffer.from(fields.Policy ?? "", "base64").toString("utf8"));
    expect(policy.conditions).toEqual(
      expect.arrayContaining([
        ["content-length-range", 1, MAX_UPLOAD_BYTES],
        ["eq", "$Content-Type", "image/webp"],
      ]),
    );
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `pnpm --filter @blog/api test -- adapters`
Expected: FAIL — không resolve được các module adapter mới.

- [ ] **Step 3: Viết mã**

`services/api/src/adapters/dynamo/buildStatusRepo.ts`:
```ts
import { type DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { BuildState, BuildStatus } from "@blog/shared";
import type { BuildStatusRepository } from "../../usecases/ports";
import { BUILD_KEY } from "./items";

export class DynamoBuildStatusRepository implements BuildStatusRepository {
  private readonly db: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(db: DynamoDBDocumentClient, tableName: string) {
    this.db = db;
    this.tableName = tableName;
  }

  async get(): Promise<BuildState> {
    const res = await this.db.send(new GetCommand({ TableName: this.tableName, Key: BUILD_KEY }));
    if (!res.Item) return { status: "idle", updatedAt: null, error: null };
    return {
      status: res.Item.status as BuildStatus,
      updatedAt: (res.Item.updatedAt as string | undefined) ?? null,
      error: (res.Item.error as string | null | undefined) ?? null,
    };
  }

  setQueued(now: string): Promise<void> {
    return this.write({ status: "queued", updatedAt: now, error: null });
  }

  setFailed(now: string, error: string): Promise<void> {
    return this.write({ status: "failed", updatedAt: now, error });
  }

  private async write(state: BuildState): Promise<void> {
    await this.db.send(new PutCommand({ TableName: this.tableName, Item: { ...BUILD_KEY, ...state } }));
  }
}
```

`services/api/src/adapters/sqs/buildQueue.ts`:
```ts
import { randomUUID } from "node:crypto";
import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import type { BuildQueue } from "../../usecases/ports";

export class SqsBuildQueue implements BuildQueue {
  private readonly sqs: SQSClient;
  private readonly queueUrl: string;

  constructor(sqs: SQSClient, queueUrl: string) {
    this.sqs = sqs;
    this.queueUrl = queueUrl;
  }

  async enqueue(reason: string): Promise<void> {
    await this.sqs.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify({ reason }),
        // One group => builds run strictly one at a time.
        MessageGroupId: "site",
        // Random id => identical requests within 5 minutes are not swallowed.
        MessageDeduplicationId: randomUUID(),
      }),
    );
  }
}
```

`services/api/src/adapters/scheduler/publishScheduler.ts`:
```ts
import {
  ConflictException,
  CreateScheduleCommand,
  type CreateScheduleCommandInput,
  DeleteScheduleCommand,
  ResourceNotFoundException,
  type SchedulerClient,
  UpdateScheduleCommand,
} from "@aws-sdk/client-scheduler";
import type { ScheduledPublishEvent } from "../../events";
import type { PublishScheduler } from "../../usecases/ports";

export interface SchedulerTarget {
  groupName: string;
  lambdaArn: string;
  roleArn: string;
}

export const scheduleName = (postId: string) => `post-${postId}`;

/** "2026-10-12T08:00:00.000Z" -> "at(2026-10-12T08:00:00)" (interpreted in UTC). */
export const atExpression = (iso: string) => `at(${iso.slice(0, 19)})`;

export class EventBridgePublishScheduler implements PublishScheduler {
  private readonly client: SchedulerClient;
  private readonly target: SchedulerTarget;

  constructor(client: SchedulerClient, target: SchedulerTarget) {
    this.client = client;
    this.target = target;
  }

  async schedule(postId: string, publishAt: string): Promise<void> {
    const event: ScheduledPublishEvent = { type: "scheduled-publish", postId, publishAt };
    const input: CreateScheduleCommandInput = {
      Name: scheduleName(postId),
      GroupName: this.target.groupName,
      ScheduleExpression: atExpression(publishAt),
      ScheduleExpressionTimezone: "UTC",
      FlexibleTimeWindow: { Mode: "OFF" },
      ActionAfterCompletion: "DELETE",
      Target: {
        Arn: this.target.lambdaArn,
        RoleArn: this.target.roleArn,
        Input: JSON.stringify(event),
      },
    };
    try {
      await this.client.send(new CreateScheduleCommand(input));
    } catch (err) {
      if (!(err instanceof ConflictException)) throw err;
      await this.client.send(new UpdateScheduleCommand(input));
    }
  }

  async cancel(postId: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteScheduleCommand({ Name: scheduleName(postId), GroupName: this.target.groupName }),
      );
    } catch (err) {
      if (err instanceof ResourceNotFoundException) return;
      throw err;
    }
  }
}
```

`services/api/src/adapters/s3/uploadSigner.ts`:
```ts
import type { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import type { ImageContentType } from "@blog/shared";
import type { UploadSigner } from "../../usecases/ports";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const UPLOAD_EXPIRES_SECONDS = 300;

export class S3UploadSigner implements UploadSigner {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(s3: S3Client, bucket: string) {
    this.s3 = s3;
    this.bucket = bucket;
  }

  async sign(key: string, contentType: ImageContentType) {
    const { url, fields } = await createPresignedPost(this.s3, {
      Bucket: this.bucket,
      Key: key,
      Conditions: [
        ["content-length-range", 1, MAX_UPLOAD_BYTES],
        ["eq", "$Content-Type", contentType],
      ],
      Fields: { "Content-Type": contentType },
      Expires: UPLOAD_EXPIRES_SECONDS,
    });
    return { url, fields };
  }
}
```

- [ ] **Step 4: Chạy test để thấy thành công**

Run: `pnpm --filter @blog/api test`
Expected: PASS.

- [ ] **Step 5: Lint + typecheck rồi commit**

```bash
pnpm format && pnpm lint && pnpm typecheck
git add services/api
git commit -m "feat(api): add build status, SQS, Scheduler and S3 upload adapters" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: HTTP router, handler lịch hẹn và entry Lambda

**Files:**
- Create: `services/api/src/handlers/http/response.ts`, `services/api/src/handlers/http/auth.ts`, `services/api/src/handlers/http/router.ts`
- Create: `services/api/src/handlers/scheduled.ts`
- Create: `services/api/src/config.ts`, `services/api/src/deps.ts`, `services/api/src/index.ts`
- Test: `services/api/test/handlers/router.test.ts`, `services/api/test/handlers/scheduled.test.ts`, `services/api/test/config.test.ts`

**Interfaces:**
- Consumes: mọi use case (Task 4–5), mọi adapter (Task 6–7), `makeDeps` (Task 4).
- Produces (Kế hoạch 4 dùng khi khai báo Lambda trong CDK):
  - Entry: `services/api/src/index.ts` export `handler(event: unknown)`
  - Biến môi trường bắt buộc: `TABLE_NAME`, `BUILD_QUEUE_URL`, `MEDIA_BUCKET`, `BLOG_BASE_URL`, `SCHEDULER_GROUP`, `SCHEDULER_TARGET_ARN`, `SCHEDULER_ROLE_ARN`
  - Route key (API Gateway HTTP API): `GET /posts`, `POST /posts`, `GET /posts/{id}`, `PUT /posts/{id}`, `DELETE /posts/{id}`, `POST /posts/{id}/publish`, `POST /posts/{id}/unpublish`, `POST /uploads`, `GET /builds/latest`, `POST /builds`
  - `handleHttp(event, deps, log: Log)`, `handleScheduled(event, deps)`, `groupsOf(event)`, `isE2EUser(event)`

- [ ] **Step 1: Viết test thất bại**

`services/api/test/handlers/router.test.ts`:
```ts
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import { groupsOf } from "../../src/handlers/http/auth";
import { handleHttp } from "../../src/handlers/http/router";
import { makeDeps } from "../fakes";

const httpEvent = (
  routeKey: string,
  opts: { body?: unknown; rawBody?: string; id?: string; groups?: unknown } = {},
) =>
  ({
    routeKey,
    pathParameters: opts.id ? { id: opts.id } : undefined,
    body: opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    isBase64Encoded: false,
    requestContext: {
      requestId: "req-1",
      authorizer: {
        jwt: {
          claims: opts.groups === undefined ? {} : { "cognito:groups": opts.groups },
          scopes: [],
        },
      },
    },
  }) as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;

const log = () => ({ error: vi.fn() });
const parse = (res: { body?: string }) => JSON.parse(res.body ?? "null");

describe("handleHttp", () => {
  it("creates a post (201) and reads it back (200)", async () => {
    const deps = makeDeps();
    const created = await handleHttp(httpEvent("POST /posts", { body: { title: "Học AWS" } }), deps, log());
    expect(created.statusCode).toBe(201);
    const { id } = parse(created);
    const read = await handleHttp(httpEvent("GET /posts/{id}", { id }), deps, log());
    expect(read.statusCode).toBe(200);
    expect(parse(read).slug).toBe("hoc-aws");
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await handleHttp(httpEvent("POST /posts", { rawBody: "{oops" }), makeDeps(), log());
    expect(res.statusCode).toBe(400);
    expect(parse(res).error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 with the failing field for schema errors", async () => {
    const res = await handleHttp(httpEvent("POST /posts", { body: { title: "" } }), makeDeps(), log());
    expect(res.statusCode).toBe(400);
    expect(parse(res).error.message).toContain("title");
  });

  it("returns 404 for an unknown post and for an unknown route", async () => {
    const deps = makeDeps();
    expect((await handleHttp(httpEvent("GET /posts/{id}", { id: "x" }), deps, log())).statusCode).toBe(404);
    expect((await handleHttp(httpEvent("GET /nope"), deps, log())).statusCode).toBe(404);
  });

  it("returns 409 SLUG_TAKEN for a duplicate slug", async () => {
    const deps = makeDeps();
    await handleHttp(httpEvent("POST /posts", { body: { title: "Same" } }), deps, log());
    const res = await handleHttp(httpEvent("POST /posts", { body: { title: "Same" } }), deps, log());
    expect(res.statusCode).toBe(409);
    expect(parse(res).error.code).toBe("SLUG_TAKEN");
  });

  it("forbids the e2e group from publishing and leaves the post unchanged", async () => {
    const deps = makeDeps();
    const { id } = parse(await handleHttp(httpEvent("POST /posts", { body: { title: "T" } }), deps, log()));
    const res = await handleHttp(
      httpEvent("POST /posts/{id}/publish", { id, body: {}, groups: "[e2e]" }),
      deps,
      log(),
    );
    expect(res.statusCode).toBe(403);
    expect(parse(res).error.code).toBe("FORBIDDEN");
    expect((await deps.posts.get(id))?.status).toBe("draft");
    expect(deps.buildQueue.reasons).toEqual([]);
  });

  it.each(["POST /posts/{id}/unpublish", "POST /builds"])("forbids e2e on %s", async (routeKey) => {
    const res = await handleHttp(httpEvent(routeKey, { id: "x", groups: "[e2e]" }), makeDeps(), log());
    expect(res.statusCode).toBe(403);
  });

  it("puts e2e uploads under media/e2e/", async () => {
    const res = await handleHttp(
      httpEvent("POST /uploads", { body: { contentType: "image/png" }, groups: "[e2e]" }),
      makeDeps(),
      log(),
    );
    expect(res.statusCode).toBe(200);
    expect(parse(res).key).toMatch(/^media\/e2e\//);
  });

  it("returns 202 with the queued state for a manual build", async () => {
    const res = await handleHttp(httpEvent("POST /builds"), makeDeps(), log());
    expect(res.statusCode).toBe(202);
    expect(parse(res).status).toBe("queued");
  });

  it("hides unexpected errors behind a 500 and logs them", async () => {
    const deps = makeDeps();
    deps.posts.list = () => Promise.reject(new Error("secret internals"));
    const sink = log();
    const res = await handleHttp(httpEvent("GET /posts"), deps, sink);
    expect(res.statusCode).toBe(500);
    expect(parse(res).error).toEqual({ code: "INTERNAL", message: "internal error" });
    expect(sink.error).toHaveBeenCalledOnce();
  });
});

describe("groupsOf", () => {
  it.each([
    [undefined, []],
    ["[e2e]", ["e2e"]],
    ["[admin e2e]", ["admin", "e2e"]],
    ["e2e", ["e2e"]],
    [["admin", "e2e"], ["admin", "e2e"]],
  ])("parses %j", (groups, expected) => {
    expect(groupsOf(httpEvent("GET /posts", { groups }))).toEqual(expected);
  });
});
```

`services/api/test/handlers/scheduled.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { handleScheduled } from "../../src/handlers/scheduled";
import { createPost, getPost } from "../../src/usecases/posts";
import { publishPost } from "../../src/usecases/publishing";
import { makeDeps } from "../fakes";

describe("handleScheduled", () => {
  it("publishes the post named in the event", async () => {
    const deps = makeDeps();
    const post = await createPost(deps, {
      title: "T",
      excerpt: "",
      content: "",
      tags: [],
      coverImage: null,
    });
    await publishPost(deps, post.id, { publishAt: "2026-10-12T08:00:00Z" });
    await handleScheduled(
      { type: "scheduled-publish", postId: post.id, publishAt: "2026-10-12T08:00:00.000Z" },
      deps,
    );
    expect((await getPost(deps, post.id)).status).toBe("published");
  });

  it("rejects a malformed event", async () => {
    await expect(handleScheduled({ type: "scheduled-publish" }, makeDeps())).rejects.toThrow();
  });
});
```

`services/api/test/config.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

const env = {
  TABLE_NAME: "BlogTable",
  BUILD_QUEUE_URL: "https://sqs.ap-northeast-1.amazonaws.com/111111111111/build.fifo",
  MEDIA_BUCKET: "blog-media",
  BLOG_BASE_URL: "https://blog.oki-dev.xyz/",
  SCHEDULER_GROUP: "blog-publish",
  SCHEDULER_TARGET_ARN: "arn:aws:lambda:ap-northeast-1:111111111111:function:api",
  SCHEDULER_ROLE_ARN: "arn:aws:iam::111111111111:role/scheduler",
};

describe("loadConfig", () => {
  it("accepts a complete environment and strips the trailing slash of BLOG_BASE_URL", () => {
    expect(loadConfig(env).BLOG_BASE_URL).toBe("https://blog.oki-dev.xyz");
  });

  it("fails fast when a variable is missing", () => {
    const { TABLE_NAME: _omit, ...rest } = env;
    expect(() => loadConfig(rest)).toThrow(/TABLE_NAME/);
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `pnpm --filter @blog/api test -- handlers config`
Expected: FAIL — không resolve được `router`, `scheduled`, `config`.

- [ ] **Step 3: Viết mã**

`services/api/src/handlers/http/response.ts`:
```ts
import type { ApiErrorBody, ErrorCode } from "@blog/shared";
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

export type HttpResult = APIGatewayProxyStructuredResultV2;

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  SLUG_TAKEN: 409,
  INVALID_STATE: 409,
  INTERNAL: 500,
};

export const json = (statusCode: number, body: unknown): HttpResult => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const noContent = (): HttpResult => ({ statusCode: 204 });

export const errorResponse = (code: ErrorCode, message: string): HttpResult =>
  json(STATUS[code], { error: { code, message } } satisfies ApiErrorBody);
```

`services/api/src/handlers/http/auth.ts`:
```ts
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";

/**
 * HTTP API JWT authorizers flatten array claims into strings such as "[admin e2e]".
 */
export function groupsOf(event: APIGatewayProxyEventV2WithJWTAuthorizer): string[] {
  const raw: unknown = event.requestContext.authorizer?.jwt?.claims?.["cognito:groups"];
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) return raw.map(String);
  return String(raw)
    .replace(/^\[|\]$/g, "")
    .split(/[\s,]+/)
    .filter(Boolean);
}

export const isE2EUser = (event: APIGatewayProxyEventV2WithJWTAuthorizer): boolean =>
  groupsOf(event).includes("e2e");
```

`services/api/src/handlers/http/router.ts`:
```ts
import {
  createPostInputSchema,
  createUploadInputSchema,
  publishInputSchema,
  updatePostInputSchema,
} from "@blog/shared";
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { ZodError } from "zod";
import { DomainError } from "../../domain/errors";
import { getLatestBuild, triggerBuild } from "../../usecases/builds";
import type { Deps } from "../../usecases/ports";
import { createPost, deletePost, getPost, listPosts, updatePost } from "../../usecases/posts";
import { publishPost, unpublishPost } from "../../usecases/publishing";
import { createUpload } from "../../usecases/uploads";
import { isE2EUser } from "./auth";
import { errorResponse, type HttpResult, json, noContent } from "./response";

export interface Log {
  error(message: string, attributes: Record<string, unknown>): void;
}

interface RouteContext {
  deps: Deps;
  id: () => string;
  body: unknown;
  e2e: boolean;
}

interface Route {
  run: (ctx: RouteContext) => Promise<HttpResult>;
  /** The e2e test account must never change what is published. */
  forbiddenForE2E?: boolean;
}

const routes: Record<string, Route> = {
  "GET /posts": { run: async ({ deps }) => json(200, await listPosts(deps)) },
  "POST /posts": {
    run: async ({ deps, body }) => json(201, await createPost(deps, createPostInputSchema.parse(body))),
  },
  "GET /posts/{id}": { run: async ({ deps, id }) => json(200, await getPost(deps, id())) },
  "PUT /posts/{id}": {
    run: async ({ deps, id, body }) =>
      json(200, await updatePost(deps, id(), updatePostInputSchema.parse(body))),
  },
  "DELETE /posts/{id}": {
    run: async ({ deps, id }) => {
      await deletePost(deps, id());
      return noContent();
    },
  },
  "POST /posts/{id}/publish": {
    forbiddenForE2E: true,
    run: async ({ deps, id, body }) =>
      json(200, await publishPost(deps, id(), publishInputSchema.parse(body ?? {}))),
  },
  "POST /posts/{id}/unpublish": {
    forbiddenForE2E: true,
    run: async ({ deps, id }) => json(200, await unpublishPost(deps, id())),
  },
  "POST /uploads": {
    run: async ({ deps, body, e2e }) =>
      json(200, await createUpload(deps, createUploadInputSchema.parse(body), { e2e })),
  },
  "GET /builds/latest": { run: async ({ deps }) => json(200, await getLatestBuild(deps)) },
  "POST /builds": {
    forbiddenForE2E: true,
    run: async ({ deps }) => {
      await triggerBuild(deps);
      return json(202, await getLatestBuild(deps));
    },
  },
};

function parseBody(event: APIGatewayProxyEventV2WithJWTAuthorizer): unknown {
  if (!event.body) return undefined;
  const text = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  try {
    return JSON.parse(text);
  } catch {
    throw new DomainError("VALIDATION_ERROR", "request body must be valid JSON");
  }
}

function toErrorResponse(err: unknown, log: Log, requestId: string): HttpResult {
  if (err instanceof DomainError) return errorResponse(err.code, err.message);
  if (err instanceof ZodError) {
    const message = err.issues
      .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
      .join("; ");
    return errorResponse("VALIDATION_ERROR", message);
  }
  log.error("unhandled error", { error: err, requestId });
  return errorResponse("INTERNAL", "internal error");
}

export async function handleHttp(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  deps: Deps,
  log: Log,
): Promise<HttpResult> {
  const route = routes[event.routeKey];
  if (!route) return errorResponse("NOT_FOUND", `no route for ${event.routeKey}`);

  const e2e = isE2EUser(event);
  if (route.forbiddenForE2E && e2e) {
    return errorResponse("FORBIDDEN", "the e2e account cannot change what is published");
  }

  try {
    const id = () => {
      const value = event.pathParameters?.id;
      if (!value) throw new DomainError("VALIDATION_ERROR", "missing path parameter: id");
      return value;
    };
    return await route.run({ deps, id, body: parseBody(event), e2e });
  } catch (err) {
    return toErrorResponse(err, log, event.requestContext.requestId);
  }
}
```

`services/api/src/handlers/scheduled.ts`:
```ts
import { scheduledPublishEventSchema } from "../events";
import type { Deps } from "../usecases/ports";
import { runScheduledPublish } from "../usecases/publishing";

export async function handleScheduled(event: unknown, deps: Deps): Promise<void> {
  const { postId, publishAt } = scheduledPublishEventSchema.parse(event);
  await runScheduledPublish(deps, { postId, publishAt });
}
```

`services/api/src/config.ts`:
```ts
import { z } from "zod";

const configSchema = z.object({
  TABLE_NAME: z.string().min(1),
  BUILD_QUEUE_URL: z.url(),
  MEDIA_BUCKET: z.string().min(1),
  BLOG_BASE_URL: z.url().transform((url) => url.replace(/\/+$/, "")),
  SCHEDULER_GROUP: z.string().min(1),
  SCHEDULER_TARGET_ARN: z.string().min(1),
  SCHEDULER_ROLE_ARN: z.string().min(1),
});
export type Config = z.infer<typeof configSchema>;

export const loadConfig = (env: Record<string, string | undefined>): Config =>
  configSchema.parse(env);
```

`services/api/src/deps.ts`:
```ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { SchedulerClient } from "@aws-sdk/client-scheduler";
import { SQSClient } from "@aws-sdk/client-sqs";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { ulid } from "ulid";
import { DynamoBuildStatusRepository } from "./adapters/dynamo/buildStatusRepo";
import { DynamoPostRepository } from "./adapters/dynamo/postRepo";
import { S3UploadSigner } from "./adapters/s3/uploadSigner";
import { EventBridgePublishScheduler } from "./adapters/scheduler/publishScheduler";
import { SqsBuildQueue } from "./adapters/sqs/buildQueue";
import type { Config } from "./config";
import type { Deps } from "./usecases/ports";

export function createDeps(config: Config): Deps {
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  return {
    posts: new DynamoPostRepository(db, config.TABLE_NAME),
    builds: new DynamoBuildStatusRepository(db, config.TABLE_NAME),
    buildQueue: new SqsBuildQueue(new SQSClient({}), config.BUILD_QUEUE_URL),
    scheduler: new EventBridgePublishScheduler(new SchedulerClient({}), {
      groupName: config.SCHEDULER_GROUP,
      lambdaArn: config.SCHEDULER_TARGET_ARN,
      roleArn: config.SCHEDULER_ROLE_ARN,
    }),
    uploads: new S3UploadSigner(new S3Client({}), config.MEDIA_BUCKET),
    now: () => new Date().toISOString(),
    newId: () => ulid(),
    blogBaseUrl: config.BLOG_BASE_URL,
  };
}
```

`services/api/src/index.ts`:
```ts
import { Logger } from "@aws-lambda-powertools/logger";
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { loadConfig } from "./config";
import { createDeps } from "./deps";
import { isScheduledPublishEvent } from "./events";
import { handleHttp } from "./handlers/http/router";
import { handleScheduled } from "./handlers/scheduled";
import type { Deps } from "./usecases/ports";

const logger = new Logger({ serviceName: "blog-api" });
let deps: Deps | undefined;

export async function handler(event: unknown) {
  deps ??= createDeps(loadConfig(process.env));
  if (isScheduledPublishEvent(event)) {
    await handleScheduled(event, deps);
    return;
  }
  return handleHttp(event as APIGatewayProxyEventV2WithJWTAuthorizer, deps, logger);
}
```

- [ ] **Step 4: Chạy toàn bộ test**

Run: `pnpm test`
Expected: PASS toàn bộ (`@blog/shared` và `@blog/api`).

- [ ] **Step 5: Lint + typecheck**

Run: `pnpm format && pnpm lint && pnpm typecheck`
Expected: không lỗi. Nếu `typecheck` báo `logger` không khớp `Log` ở `index.ts`, giữ nguyên interface `Log` (khai báo dạng method để TypeScript so khớp tham số hai chiều) và kiểm tra lại chữ ký `Logger.error` của Powertools 2.36.0.

- [ ] **Step 6: Xác nhận domain không phụ thuộc AWS**

Run: `grep -rn "@aws-sdk\|adapters/" services/api/src/domain || echo "OK: domain is AWS-free"`
Expected: in ra `OK: domain is AWS-free`.

- [ ] **Step 7: Commit**

```bash
git add services/api
git commit -m "feat(api): add HTTP router, scheduled handler and Lambda entry point" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Hoàn tất Kế hoạch 1

Khi xong 8 task:

- `pnpm lint && pnpm typecheck && pnpm test` xanh từ thư mục gốc.
- Nhánh `feat/plan-1-api` sẵn sàng merge. Repo chưa có remote GitHub (Kế hoạch 6 tạo repo, ruleset và CI), nên ở giai đoạn này merge bằng `git merge --squash` vào `main` trên máy sau khi tác giả review.
- Kế hoạch 4 dùng entry `services/api/src/index.ts`, danh sách biến môi trường và route key ở Task 8 để khai báo Lambda + API Gateway trong CDK.
