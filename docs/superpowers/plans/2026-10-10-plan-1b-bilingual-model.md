# Kế hoạch 1b: Mô hình song ngữ (vi/ja) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuyển `packages/shared` và `services/api` từ "một bài = một ngôn ngữ" sang "một bài có tối đa hai bản `vi`/`ja`, đăng độc lập", thêm quản lý tag có tên song ngữ, theo spec giao diện & đa ngôn ngữ.

**Architecture:** Giữ nguyên 4 lớp của Kế hoạch 1 (`domain` thuần → `usecases` qua port → `adapters` AWS → `handlers`). Bài viết vẫn là **một item DynamoDB**, trường `versions: { vi?, ja? }` chứa từng bản. Slug giữ duy nhất **toàn site** bằng item `SLUG#<slug>` `{postId, lang}`. Tag có item riêng `TAG#<key>` liệt kê qua GSI `byUpdated` (`GSI1PK = "TAG"`). Quy tắc build: **chỉ build khi "phần công khai" của bài thay đổi** (các bản đã đăng + tag + ảnh bìa của bài có bản đã đăng).

**Tech Stack:** như Kế hoạch 1 — Node.js 24, TypeScript 7.0.2, pnpm 12.10.1, Vitest 5.0.3, zod 4.6.5, AWS SDK v3 3.1146.0, Biome 2.5.15.

**Spec:**
- [`docs/superpowers/specs/2026-10-10-ui-i18n-design.md`](../specs/2026-10-10-ui-i18n-design.md) — mục 3 (mô hình & API) là chính; **ưu tiên khi mâu thuẫn**.
- [`docs/superpowers/specs/2026-10-10-serverless-blog-design.md`](../specs/2026-10-10-serverless-blog-design.md) — các mục 3, 5.1, 5.2 vẫn còn hiệu lực.

**Vị trí:** sau Kế hoạch 1 (đã merge), trước Kế hoạch 2. Không deploy gì.

## Global Constraints

- Mọi ràng buộc chung của Kế hoạch 1 vẫn áp dụng (pnpm catalog, TS strict + `noUncheckedIndexedAccess`, Biome, domain không import `@aws-sdk/*`, thời điểm ISO UTC từ `toISOString()`, định dạng lỗi API, mã lỗi → HTTP, presigned POST ảnh, SQS FIFO `MessageGroupId = "site"`).
- **Không dùng `minimumReleaseAgeExclude`**; không thêm thư viện mới trong kế hoạch này.
- Ngôn ngữ: chỉ `"vi"` và `"ja"` (`LANGS`). `{lang}` khác trong URL → `400 VALIDATION_ERROR`.
- Nội dung mỗi bản ≤ **180.000 byte UTF-8**.
- Slug **duy nhất toàn site** (giữa mọi bài và mọi ngôn ngữ). Tiêu đề không có chữ Latin → slug `<id viết thường>-<lang>`.
- Lịch hẹn: tên `post-<id>-<lang>`; sự kiện `{ type: "scheduled-publish", postId, lang, publishAt }`.
- **Build lại khi và chỉ khi phần công khai thay đổi**: tập các bản `published` (toàn bộ trường), `tags`, `coverImage` — chỉ tính khi bài có ít nhất một bản `published`. Đổi tên tag → build nếu tag đó gắn với bài có bản `published`.
- Tài khoản E2E (nhóm `e2e`): cấm `.../publish`, `.../unpublish`, `POST /builds`; chỉ được sửa/xoá bài **không có bản nào `published` hoặc `scheduled`**; chỉ được đổi tên tag **không gắn với bài nào như vậy**.
- Tác dụng phụ sau một lần ghi đã commit (huỷ lịch, gửi build) dùng `afterCommit` (log, không ném lỗi) — giữ như Kế hoạch 1.
- **Trạng thái trung gian:** kế hoạch thay đổi kiểu dữ liệu nền tảng nên từ Task 1 đến Task 7 **một số file chưa chuyển sẽ không typecheck/không chạy được**. Mỗi task chỉ yêu cầu xanh các file test **liệt kê trong task đó và các task trước**. Task 8 phải đưa `pnpm lint && pnpm typecheck && pnpm test` về xanh toàn bộ.
- Commit message kết thúc bằng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Tự lưu bản nháp `ja` của bài đã đăng bản `vi` không được sinh build** (nếu sai: cứ 3 giây một lượt build). → Task 2 (`needsRebuild`), Task 3 (`upsertVersion`).
2. **Slug trùng giữa hai ngôn ngữ / hai bài** (bản `ja` của bài B dùng lại slug bản `vi` của bài A; bản `ja` dùng lại slug bản `vi` của chính bài đó) → `409 SLUG_TAKEN`, không ghi đè. → Task 3 (fake), Task 6 (DynamoDB).
3. **Lịch hẹn của ngôn ngữ này nổ khi ngôn ngữ kia đã đổi**: sự kiện `ja` không được đăng bản `vi`; sự kiện cũ (đổi giờ, xoá bản) bị bỏ qua, không build. → Task 4.
4. **Xoá bản ngôn ngữ cuối cùng** → `409 INVALID_STATE` (phải xoá cả bài); xoá bản đang hẹn giờ phải huỷ đúng lịch `post-<id>-<lang>`. → Task 3.
5. **Tài khoản E2E sửa bài đang có bản đăng/hẹn giờ qua bất kỳ route ghi nào** (`PUT /posts/{id}`, `PUT/DELETE .../versions/{lang}`, `DELETE /posts/{id}`, `PUT /tags/{key}`) → `403`. → Task 3, Task 5, Task 8.

---

## Cấu trúc file

```
packages/shared/src/
  post.ts          # SỬA: Lang, LangVersion, Post (versions), PostSummary, LIMITS, schema mới
  tag.ts           # MỚI: Tag, TagSummary, putTagInputSchema
  index.ts         # SỬA: export tag
packages/shared/test/schemas.test.ts           # VIẾT LẠI

services/api/src/
  domain/post.ts   # VIẾT LẠI: newPost, updateShared, applyVersion, withoutVersion, publish,
                   #   unpublish, publishScheduled, needsRebuild, isLive, isPublished,
                   #   scheduledLangs, slugEntries, getVersion, toSummary
  usecases/ports.ts       # SỬA: TagRepository, PublishScheduler có lang, Deps.tags
  usecases/posts.ts       # VIẾT LẠI: CRUD phần chung + Caller
  usecases/versions.ts    # MỚI: upsertVersion, deleteVersion
  usecases/publishing.ts  # VIẾT LẠI: publishVersion, unpublishVersion, runScheduledPublish
  usecases/tags.ts        # MỚI: listTags, putTag
  events.ts               # SỬA: thêm lang
  adapters/dynamo/items.ts      # SỬA: tagKey, toTagItem, fromTagItem
  adapters/dynamo/queryIndex.ts # MỚI: query GSI byUpdated theo partition
  adapters/dynamo/postRepo.ts   # VIẾT LẠI: nhiều slug / bài
  adapters/dynamo/tagRepo.ts    # MỚI
  adapters/scheduler/publishScheduler.ts  # SỬA: lang
  handlers/http/router.ts # VIẾT LẠI: route mới
  handlers/scheduled.ts   # SỬA: lang
  deps.ts                 # SỬA: tags repo, removeUndefinedValues
services/api/test/
  fakes.ts, fixtures.ts                       # SỬA
  domain/post.test.ts                         # VIẾT LẠI
  usecases/posts.test.ts, versions.test.ts, publishing.test.ts, tags.test.ts, afterCommit.test.ts
  adapters/postRepo.test.ts, tagRepo.test.ts, publishScheduler.test.ts
  handlers/router.test.ts, scheduled.test.ts
```

Không đổi: `domain/slug.ts`, `domain/errors.ts`, `usecases/builds.ts`, `usecases/uploads.ts`, `usecases/afterCommit.ts`, `adapters/dynamo/buildStatusRepo.ts`, `adapters/sqs/*`, `adapters/s3/*`, `handlers/http/{auth,response}.ts`, `config.ts`, `index.ts` và test của chúng.

---

### Task 1: Kiểu dữ liệu & schema song ngữ (`packages/shared`)

**Files:**
- Modify: `packages/shared/src/post.ts` (thay toàn bộ), `packages/shared/src/index.ts`
- Create: `packages/shared/src/tag.ts`
- Test: `packages/shared/test/schemas.test.ts` (thay toàn bộ)

**Interfaces:**
- Produces (`@blog/shared`):
  - `LANGS = ["vi","ja"] as const`, `type Lang`, `langSchema`, `otherLang(lang): Lang`
  - `type PostStatus`, `interface LangVersion { slug; title; excerpt; content; status; publishAt: string|null; publishedAt: string|null; updatedAt }`
  - `type Versions = Partial<Record<Lang, LangVersion>>`
  - `interface Post { id; tags: string[]; coverImage: string|null; createdAt; updatedAt; version: number; versions: Versions }`
  - `type LangVersionSummary = Omit<LangVersion,"content">`, `interface PostSummary extends Omit<Post,"versions"> { versions: Partial<Record<Lang, LangVersionSummary>> }`
  - `LIMITS = { titleMax: 200, excerptMax: 500, contentMaxBytes: 180_000, tagsMax: 20, tagMax: 30, slugMax: 100, tagNameMax: 50 }`, `utf8Bytes`
  - `createPostInputSchema` → `CreatePostInput { lang; title; slug?; excerpt; content; tags; coverImage }`
  - `updatePostInputSchema` → `UpdatePostInput { tags; coverImage; version }`
  - `upsertVersionInputSchema` → `UpsertVersionInput { title; slug?; excerpt; content; version }`
  - `publishInputSchema` → `PublishInput` (không đổi)
  - `interface Tag { key: string; names: Partial<Record<Lang,string>> }`, `interface TagSummary extends Tag { postCount: number }`, `putTagInputSchema` → `PutTagInput { names }`
  - Không đổi: `build.ts`, `errors.ts`, `upload.ts`

- [ ] **Step 1: Tạo nhánh**

```bash
git checkout -b feat/plan-1b-bilingual
```

- [ ] **Step 2: Viết test thất bại**

`packages/shared/test/schemas.test.ts` (thay toàn bộ):
```ts
import { describe, expect, it } from "vitest";
import {
  createPostInputSchema,
  createUploadInputSchema,
  LIMITS,
  langSchema,
  otherLang,
  publishInputSchema,
  putTagInputSchema,
  updatePostInputSchema,
  upsertVersionInputSchema,
  utf8Bytes,
} from "../src/index";

describe("langSchema / otherLang", () => {
  it("accepts only vi and ja", () => {
    expect(langSchema.safeParse("vi").success).toBe(true);
    expect(langSchema.safeParse("ja").success).toBe(true);
    expect(langSchema.safeParse("en").success).toBe(false);
  });

  it("returns the other language", () => {
    expect(otherLang("vi")).toBe("ja");
    expect(otherLang("ja")).toBe("vi");
  });
});

describe("createPostInputSchema", () => {
  it("requires a language and applies defaults", () => {
    expect(createPostInputSchema.parse({ lang: "vi", title: "Học AWS" })).toEqual({
      lang: "vi",
      title: "Học AWS",
      excerpt: "",
      content: "",
      tags: [],
      coverImage: null,
    });
  });

  it("rejects a missing or unknown language", () => {
    expect(createPostInputSchema.safeParse({ title: "t" }).success).toBe(false);
    expect(createPostInputSchema.safeParse({ lang: "en", title: "t" }).success).toBe(false);
  });

  it("rejects a whitespace-only title", () => {
    expect(createPostInputSchema.safeParse({ lang: "vi", title: "   " }).success).toBe(false);
  });

  it("limits content to 180 KB counted in UTF-8 bytes", () => {
    const content = "ệ".repeat(60_001); // 60,001 chars, 180,003 bytes
    expect(LIMITS.contentMaxBytes).toBe(180_000);
    expect(content.length).toBeLessThan(LIMITS.contentMaxBytes);
    expect(utf8Bytes(content)).toBeGreaterThan(LIMITS.contentMaxBytes);
    expect(createPostInputSchema.safeParse({ lang: "vi", title: "t", content }).success).toBe(false);
  });

  it("rejects a javascript: cover image and accepts media/https", () => {
    const parse = (coverImage: string) =>
      createPostInputSchema.safeParse({ lang: "vi", title: "t", coverImage }).success;
    expect(parse("javascript:alert(1)")).toBe(false);
    expect(parse("/media/2026/x.webp")).toBe(true);
    expect(parse("https://blog.oki-dev.xyz/media/2026/x.webp")).toBe(true);
  });
});

describe("updatePostInputSchema (shared fields)", () => {
  it("accepts tags, cover image and a positive integer version", () => {
    expect(updatePostInputSchema.safeParse({ tags: [], coverImage: null, version: 2 }).success).toBe(
      true,
    );
    expect(updatePostInputSchema.safeParse({ tags: [], coverImage: null, version: 0 }).success).toBe(
      false,
    );
  });
});

describe("upsertVersionInputSchema", () => {
  it("makes the slug optional", () => {
    const r = upsertVersionInputSchema.safeParse({ title: "t", excerpt: "", content: "", version: 1 });
    expect(r.success).toBe(true);
  });

  it("requires a title", () => {
    const r = upsertVersionInputSchema.safeParse({ excerpt: "", content: "", version: 1 });
    expect(r.success).toBe(false);
  });
});

describe("publishInputSchema", () => {
  it("accepts an empty body and UTC timestamps, rejects offsets", () => {
    expect(publishInputSchema.parse({})).toEqual({});
    expect(publishInputSchema.safeParse({ publishAt: "2026-10-12T08:00:00.123Z" }).success).toBe(true);
    expect(publishInputSchema.safeParse({ publishAt: "2026-10-12T08:00:00+09:00" }).success).toBe(
      false,
    );
  });
});

describe("createUploadInputSchema", () => {
  it("rejects SVG", () => {
    expect(createUploadInputSchema.safeParse({ contentType: "image/webp" }).success).toBe(true);
    expect(createUploadInputSchema.safeParse({ contentType: "image/svg+xml" }).success).toBe(false);
  });
});

describe("putTagInputSchema", () => {
  it("trims names and allows either language", () => {
    expect(putTagInputSchema.parse({ names: { ja: " 暮らし " } })).toEqual({ names: { ja: "暮らし" } });
  });

  it("rejects an empty name", () => {
    expect(putTagInputSchema.safeParse({ names: { vi: "   " } }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Chạy test để thấy thất bại**

Run: `pnpm --filter @blog/shared test`
Expected: FAIL — `langSchema`/`otherLang`/`upsertVersionInputSchema`/`putTagInputSchema` không được export.

- [ ] **Step 4: Viết mã**

`packages/shared/src/post.ts` (thay toàn bộ):
```ts
import { z } from "zod";

export const LANGS = ["vi", "ja"] as const;
export type Lang = (typeof LANGS)[number];
export const langSchema = z.enum(LANGS);
export const otherLang = (lang: Lang): Lang => (lang === "vi" ? "ja" : "vi");

export const POST_STATUSES = ["draft", "scheduled", "published"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export interface LangVersion {
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  status: PostStatus;
  publishAt: string | null;
  publishedAt: string | null;
  updatedAt: string;
}

export type Versions = Partial<Record<Lang, LangVersion>>;

export interface Post {
  id: string;
  tags: string[];
  coverImage: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  versions: Versions;
}

export type LangVersionSummary = Omit<LangVersion, "content">;

export interface PostSummary extends Omit<Post, "versions"> {
  versions: Partial<Record<Lang, LangVersionSummary>>;
}

export const LIMITS = {
  titleMax: 200,
  excerptMax: 500,
  contentMaxBytes: 180_000,
  tagsMax: 20,
  tagMax: 30,
  slugMax: 100,
  tagNameMax: 50,
} as const;

const encoder = new TextEncoder();
export const utf8Bytes = (s: string): number => encoder.encode(s).length;

const titleSchema = z.string().trim().min(1).max(LIMITS.titleMax);
const slugInputSchema = z.string().max(LIMITS.slugMax);
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
const versionSchema = z.number().int().positive();

export const createPostInputSchema = z.object({
  lang: langSchema,
  title: titleSchema,
  slug: slugInputSchema.optional(),
  excerpt: excerptSchema.default(""),
  content: contentSchema.default(""),
  tags: tagsSchema.default([]),
  coverImage: coverImageSchema.default(null),
});
export type CreatePostInput = z.infer<typeof createPostInputSchema>;

/** Shared, language-independent fields. */
export const updatePostInputSchema = z.object({
  tags: tagsSchema,
  coverImage: coverImageSchema,
  version: versionSchema,
});
export type UpdatePostInput = z.infer<typeof updatePostInputSchema>;

/** Creates or edits one language version. */
export const upsertVersionInputSchema = z.object({
  title: titleSchema,
  slug: slugInputSchema.optional(),
  excerpt: excerptSchema,
  content: contentSchema,
  version: versionSchema,
});
export type UpsertVersionInput = z.infer<typeof upsertVersionInputSchema>;

export const publishInputSchema = z.object({
  publishAt: z.iso.datetime().optional(),
});
export type PublishInput = z.infer<typeof publishInputSchema>;
```

`packages/shared/src/tag.ts`:
```ts
import { z } from "zod";
import { LIMITS, type Lang } from "./post";

export interface Tag {
  /** URL-safe key, e.g. "life". */
  key: string;
  names: Partial<Record<Lang, string>>;
}

export interface TagSummary extends Tag {
  postCount: number;
}

const tagNameSchema = z.string().trim().min(1).max(LIMITS.tagNameMax);

export const putTagInputSchema = z.object({
  names: z.object({ vi: tagNameSchema.optional(), ja: tagNameSchema.optional() }),
});
export type PutTagInput = z.infer<typeof putTagInputSchema>;
```

`packages/shared/src/index.ts`:
```ts
export * from "./build";
export * from "./errors";
export * from "./post";
export * from "./tag";
export * from "./upload";
```

- [ ] **Step 5: Chạy test để thấy thành công**

Run: `pnpm --filter @blog/shared test && pnpm --filter @blog/shared typecheck`
Expected: PASS; typecheck của `@blog/shared` sạch. (`@blog/api` lúc này chưa typecheck được — đúng như Global Constraints.)

- [ ] **Step 6: Commit**

```bash
pnpm format
git add packages/shared
git commit -m "feat(shared): bilingual post model, version and tag schemas" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Domain bài viết song ngữ

**Files:**
- Modify: `services/api/src/domain/post.ts` (thay toàn bộ)
- Test: `services/api/test/domain/post.test.ts` (thay toàn bộ)

**Interfaces:**
- Consumes: Task 1; `DomainError`, `slugify`, `isValidSlug`, `normalizeTags` (Kế hoạch 1, không đổi).
- Produces:
  - `SCHEDULE_MIN_LEAD_MS = 60_000`
  - `newPost(input: CreatePostInput, ctx: { id: string; now: string }): Post`
  - `updateShared(post, input: UpdatePostInput, now): Post`
  - `applyVersion(post, lang, input: UpsertVersionInput, now): Post`
  - `withoutVersion(post, lang, now): Post`
  - `publish(post, lang, publishAt: string | undefined, now): Post`
  - `unpublish(post, lang, now): Post`
  - `publishScheduled(post, lang, scheduledFor, now): Post | null`
  - `needsRebuild(before: Post | null, after: Post | null): boolean`
  - `isPublished(post): boolean`, `isLive(post): boolean`, `scheduledLangs(post): Lang[]`
  - `slugEntries(post): Array<{ lang: Lang; slug: string }>`, `getVersion(post, lang): LangVersion`, `toSummary(post): PostSummary`

- [ ] **Step 1: Viết test thất bại**

`services/api/test/domain/post.test.ts` (thay toàn bộ):
```ts
import type { Post } from "@blog/shared";
import { describe, expect, it } from "vitest";
import {
  applyVersion,
  isLive,
  needsRebuild,
  newPost,
  publish,
  publishScheduled,
  scheduledLangs,
  slugEntries,
  toSummary,
  unpublish,
  updateShared,
  withoutVersion,
} from "../../src/domain/post";

const NOW = "2026-10-10T00:00:00.000Z";
const LATER = "2026-10-11T00:00:00.000Z";
const ID = "01JABCDEFGHJKMNPQRSTVWXYZ0";
const FUTURE = "2026-10-12T08:00:00Z";

const viDraft = (): Post =>
  newPost(
    { lang: "vi", title: "Học AWS", excerpt: "", content: "# Hi", tags: ["AWS"], coverImage: null },
    { id: ID, now: NOW },
  );
const jaInput = (version: number) => ({
  title: "AWSを学ぶ",
  excerpt: "",
  content: "# こんにちは",
  version,
});

describe("newPost", () => {
  it("creates a post with one draft version at post version 1", () => {
    expect(viDraft()).toEqual({
      id: ID,
      tags: ["aws"],
      coverImage: null,
      createdAt: NOW,
      updatedAt: NOW,
      version: 1,
      versions: {
        vi: {
          slug: "hoc-aws",
          title: "Học AWS",
          excerpt: "",
          content: "# Hi",
          status: "draft",
          publishAt: null,
          publishedAt: null,
          updatedAt: NOW,
        },
      },
    });
  });

  it("falls back to <id>-<lang> when the title has no latin characters", () => {
    const post = newPost(
      { lang: "ja", title: "東京の秋", excerpt: "", content: "", tags: [], coverImage: null },
      { id: ID, now: NOW },
    );
    expect(post.versions.ja?.slug).toBe(`${ID.toLowerCase()}-ja`);
  });

  it("normalizes an explicit slug and rejects one without latin characters", () => {
    const make = (slug: string) =>
      newPost(
        { lang: "vi", title: "x", slug, excerpt: "", content: "", tags: [], coverImage: null },
        { id: ID, now: NOW },
      );
    expect(make("My Custom Slug").versions.vi?.slug).toBe("my-custom-slug");
    expect(() => make("日本")).toThrowError(expect.objectContaining({ code: "VALIDATION_ERROR" }));
  });
});

describe("updateShared", () => {
  it("replaces tags and cover image and bumps the version", () => {
    const next = updateShared(viDraft(), { tags: ["Life"], coverImage: "/media/a.webp", version: 1 }, LATER);
    expect(next).toMatchObject({ tags: ["life"], coverImage: "/media/a.webp", version: 2, updatedAt: LATER });
  });

  it("throws VERSION_CONFLICT on a stale version", () => {
    expect(() => updateShared(viDraft(), { tags: [], coverImage: null, version: 7 }, LATER)).toThrowError(
      expect.objectContaining({ code: "VERSION_CONFLICT" }),
    );
  });
});

describe("applyVersion", () => {
  it("adds a ja draft and leaves vi untouched", () => {
    const before = viDraft();
    const next = applyVersion(before, "ja", jaInput(1), LATER);
    expect(next.version).toBe(2);
    expect(next.versions.vi).toEqual(before.versions.vi);
    expect(next.versions.ja).toMatchObject({
      title: "AWSを学ぶ",
      slug: "aws",
      status: "draft",
      updatedAt: LATER,
    });
  });

  it("keeps status, publish dates and slug when editing an existing version without a slug", () => {
    const published = publish(viDraft(), "vi", undefined, NOW);
    const next = applyVersion(
      published,
      "vi",
      { title: "Tiêu đề mới", excerpt: "e", content: "c", version: published.version },
      LATER,
    );
    expect(next.versions.vi).toMatchObject({
      title: "Tiêu đề mới",
      slug: "hoc-aws",
      status: "published",
      publishedAt: NOW,
    });
  });

  it("normalizes an explicit new slug", () => {
    const next = applyVersion(viDraft(), "vi", { ...jaInput(1), title: "x", slug: "New Slug" }, LATER);
    expect(next.versions.vi?.slug).toBe("new-slug");
  });

  it("throws VERSION_CONFLICT on a stale version", () => {
    expect(() => applyVersion(viDraft(), "ja", jaInput(5), LATER)).toThrowError(
      expect.objectContaining({ code: "VERSION_CONFLICT" }),
    );
  });
});

describe("withoutVersion", () => {
  it("removes one of two versions", () => {
    const both = applyVersion(viDraft(), "ja", jaInput(1), NOW);
    const next = withoutVersion(both, "ja", LATER);
    expect(next.versions.ja).toBeUndefined();
    expect(next.versions.vi).toBeDefined();
    expect(next.version).toBe(3);
  });

  it("refuses to remove the only version", () => {
    expect(() => withoutVersion(viDraft(), "vi", LATER)).toThrowError(
      expect.objectContaining({ code: "INVALID_STATE" }),
    );
  });

  it("throws NOT_FOUND for a missing version", () => {
    expect(() => withoutVersion(viDraft(), "ja", LATER)).toThrowError(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
  });
});

describe("publish", () => {
  it("publishes one language now and leaves the other untouched", () => {
    const both = applyVersion(viDraft(), "ja", jaInput(1), NOW);
    const next = publish(both, "vi", undefined, LATER);
    expect(next.versions.vi).toMatchObject({ status: "published", publishedAt: LATER, publishAt: null });
    expect(next.versions.ja?.status).toBe("draft");
  });

  it("publishes immediately for past times and times within 60 seconds", () => {
    expect(publish(viDraft(), "vi", "2026-10-09T00:00:00Z", NOW).versions.vi?.status).toBe("published");
    expect(publish(viDraft(), "vi", "2026-10-10T00:00:59Z", NOW).versions.vi?.status).toBe("published");
  });

  it("schedules future times truncated to the second, and allows rescheduling", () => {
    const scheduled = publish(viDraft(), "vi", "2026-10-12T08:00:00.123Z", NOW);
    expect(scheduled.versions.vi).toMatchObject({ status: "scheduled", publishAt: "2026-10-12T08:00:00.000Z" });
    const moved = publish(scheduled, "vi", "2026-10-13T08:00:00Z", NOW);
    expect(moved.versions.vi?.publishAt).toBe("2026-10-13T08:00:00.000Z");
  });

  it("refuses to publish an already published version", () => {
    const published = publish(viDraft(), "vi", undefined, NOW);
    expect(() => publish(published, "vi", undefined, NOW)).toThrowError(
      expect.objectContaining({ code: "INVALID_STATE" }),
    );
  });

  it("keeps the first publishedAt when republishing", () => {
    const first = publish(viDraft(), "vi", undefined, NOW);
    const again = publish(unpublish(first, "vi", LATER), "vi", undefined, "2026-10-12T00:00:00.000Z");
    expect(again.versions.vi?.publishedAt).toBe(NOW);
  });

  it("throws NOT_FOUND for a missing version", () => {
    expect(() => publish(viDraft(), "ja", undefined, NOW)).toThrowError(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
  });
});

describe("unpublish", () => {
  it("moves a scheduled version back to draft", () => {
    const scheduled = publish(viDraft(), "vi", FUTURE, NOW);
    expect(unpublish(scheduled, "vi", NOW).versions.vi).toMatchObject({ status: "draft", publishAt: null });
  });

  it("refuses to unpublish a draft", () => {
    expect(() => unpublish(viDraft(), "vi", NOW)).toThrowError(
      expect.objectContaining({ code: "INVALID_STATE" }),
    );
  });
});

describe("publishScheduled", () => {
  const scheduled = publish(viDraft(), "vi", FUTURE, NOW);

  it("publishes the matching language at the scheduled time", () => {
    const next = publishScheduled(scheduled, "vi", "2026-10-12T08:00:00.000Z", LATER);
    expect(next?.versions.vi).toMatchObject({
      status: "published",
      publishAt: null,
      publishedAt: "2026-10-12T08:00:00.000Z",
    });
  });

  it("ignores a stale time, another language, or a version that is no longer scheduled", () => {
    expect(publishScheduled(scheduled, "vi", "2026-10-11T08:00:00.000Z", LATER)).toBeNull();
    expect(publishScheduled(scheduled, "ja", "2026-10-12T08:00:00.000Z", LATER)).toBeNull();
    expect(publishScheduled(unpublish(scheduled, "vi", NOW), "vi", "2026-10-12T08:00:00.000Z", LATER)).toBeNull();
  });
});

describe("needsRebuild", () => {
  const draft = viDraft();
  const published = publish(draft, "vi", undefined, NOW);
  const withJaDraft = applyVersion(published, "ja", jaInput(published.version), NOW);

  it.each([
    ["draft edit", draft, applyVersion(draft, "vi", { ...jaInput(1), title: "x" }, LATER), false],
    ["shared edit of a draft-only post", draft, updateShared(draft, { tags: ["x"], coverImage: null, version: 1 }, LATER), false],
    ["publish", draft, published, true],
    ["ja draft edit while vi is published", withJaDraft, applyVersion(withJaDraft, "ja", { ...jaInput(withJaDraft.version), content: "more" }, LATER), false],
    ["published vi edit", published, applyVersion(published, "vi", { ...jaInput(published.version), title: "x" }, LATER), true],
    ["shared edit of a published post", published, updateShared(published, { tags: ["x"], coverImage: null, version: published.version }, LATER), true],
    ["unpublish", published, unpublish(published, "vi", LATER), true],
    ["delete published", published, null, true],
    ["delete draft", draft, null, false],
  ] as const)("%s -> %s", (_name, before, after, expected) => {
    expect(needsRebuild(before, after)).toBe(expected);
  });
});

describe("isLive / scheduledLangs / slugEntries / toSummary", () => {
  const both = applyVersion(viDraft(), "ja", jaInput(1), NOW);

  it("isLive is true when any version is published or scheduled", () => {
    expect(isLive(both)).toBe(false);
    expect(isLive(publish(both, "ja", FUTURE, NOW))).toBe(true);
    expect(isLive(publish(both, "vi", undefined, NOW))).toBe(true);
  });

  it("lists scheduled languages and slugs", () => {
    expect(scheduledLangs(publish(both, "ja", FUTURE, NOW))).toEqual(["ja"]);
    expect(slugEntries(both)).toEqual([
      { lang: "vi", slug: "hoc-aws" },
      { lang: "ja", slug: "aws" },
    ]);
  });

  it("toSummary drops content from every version", () => {
    const summary = toSummary(both);
    expect(summary.versions.vi).not.toHaveProperty("content");
    expect(summary.versions.ja).not.toHaveProperty("content");
    expect(summary.versions.ja?.title).toBe("AWSを学ぶ");
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `pnpm --filter @blog/api exec vitest run test/domain`
Expected: FAIL — `updateShared`, `applyVersion`, … không được export.

- [ ] **Step 3: Viết mã**

`services/api/src/domain/post.ts` (thay toàn bộ):
```ts
import {
  type CreatePostInput,
  type Lang,
  LANGS,
  type LangVersion,
  type Post,
  type PostStatus,
  type PostSummary,
  type UpdatePostInput,
  type UpsertVersionInput,
  type Versions,
} from "@blog/shared";
import { DomainError } from "./errors";
import { isValidSlug, normalizeTags, slugify } from "./slug";

/** Schedules closer than this are published immediately instead. */
export const SCHEDULE_MIN_LEAD_MS = 60_000;

function resolveSlug(requested: string, title: string, id: string, lang: Lang): string {
  if (requested.trim() !== "") {
    const slug = slugify(requested);
    if (!isValidSlug(slug)) {
      throw new DomainError("VALIDATION_ERROR", "slug must contain at least one latin letter or digit");
    }
    return slug;
  }
  const fromTitle = slugify(title);
  return fromTitle !== "" ? fromTitle : `${id.toLowerCase()}-${lang}`;
}

function truncateToSecond(iso: string): string {
  const ms = Date.parse(iso);
  return new Date(ms - (ms % 1000)).toISOString();
}

function assertVersion(post: Post, expected: number) {
  if (expected !== post.version) {
    throw new DomainError(
      "VERSION_CONFLICT",
      `post was modified elsewhere (current version ${post.version})`,
    );
  }
}

export function getVersion(post: Post, lang: Lang): LangVersion {
  const version = post.versions[lang];
  if (!version) throw new DomainError("NOT_FOUND", `${lang} version not found`);
  return version;
}

function withVersion(post: Post, lang: Lang, version: LangVersion | undefined, now: string): Post {
  const versions: Versions = { ...post.versions };
  if (version) versions[lang] = version;
  else delete versions[lang];
  return { ...post, versions, updatedAt: now, version: post.version + 1 };
}

export function newPost(input: CreatePostInput, ctx: { id: string; now: string }): Post {
  const versions: Versions = {};
  versions[input.lang] = {
    slug: resolveSlug(input.slug ?? "", input.title, ctx.id, input.lang),
    title: input.title,
    excerpt: input.excerpt,
    content: input.content,
    status: "draft",
    publishAt: null,
    publishedAt: null,
    updatedAt: ctx.now,
  };
  return {
    id: ctx.id,
    tags: normalizeTags(input.tags),
    coverImage: input.coverImage,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    version: 1,
    versions,
  };
}

export function updateShared(post: Post, input: UpdatePostInput, now: string): Post {
  assertVersion(post, input.version);
  return {
    ...post,
    tags: normalizeTags(input.tags),
    coverImage: input.coverImage,
    updatedAt: now,
    version: post.version + 1,
  };
}

export function applyVersion(post: Post, lang: Lang, input: UpsertVersionInput, now: string): Post {
  assertVersion(post, input.version);
  const existing = post.versions[lang];
  const requested = input.slug ?? "";
  const slug =
    requested.trim() !== ""
      ? resolveSlug(requested, input.title, post.id, lang)
      : (existing?.slug ?? resolveSlug("", input.title, post.id, lang));
  const fields = { slug, title: input.title, excerpt: input.excerpt, content: input.content, updatedAt: now };
  const next: LangVersion = existing
    ? { ...existing, ...fields }
    : { ...fields, status: "draft", publishAt: null, publishedAt: null };
  return withVersion(post, lang, next, now);
}

export function withoutVersion(post: Post, lang: Lang, now: string): Post {
  getVersion(post, lang);
  if (LANGS.filter((l) => post.versions[l]).length === 1) {
    throw new DomainError(
      "INVALID_STATE",
      "cannot remove the only language version, delete the post instead",
    );
  }
  return withVersion(post, lang, undefined, now);
}

export function publish(post: Post, lang: Lang, publishAt: string | undefined, now: string): Post {
  const current = getVersion(post, lang);
  if (current.status === "published") {
    throw new DomainError("INVALID_STATE", `${lang} version is already published`);
  }
  if (publishAt !== undefined) {
    const at = truncateToSecond(publishAt);
    if (Date.parse(at) - Date.parse(now) > SCHEDULE_MIN_LEAD_MS) {
      return withVersion(post, lang, { ...current, status: "scheduled", publishAt: at, updatedAt: now }, now);
    }
  }
  return withVersion(
    post,
    lang,
    {
      ...current,
      status: "published",
      publishAt: null,
      publishedAt: current.publishedAt ?? now,
      updatedAt: now,
    },
    now,
  );
}

export function unpublish(post: Post, lang: Lang, now: string): Post {
  const current = getVersion(post, lang);
  if (current.status === "draft") {
    throw new DomainError("INVALID_STATE", `${lang} version is not published or scheduled`);
  }
  return withVersion(post, lang, { ...current, status: "draft", publishAt: null, updatedAt: now }, now);
}

/** Returns null when the scheduled event is stale (rescheduled, unpublished, removed, other language). */
export function publishScheduled(post: Post, lang: Lang, scheduledFor: string, now: string): Post | null {
  const current = post.versions[lang];
  if (!current || current.status !== "scheduled" || current.publishAt !== scheduledFor) return null;
  return withVersion(
    post,
    lang,
    {
      ...current,
      status: "published",
      publishAt: null,
      publishedAt: current.publishedAt ?? scheduledFor,
      updatedAt: now,
    },
    now,
  );
}

const hasStatus = (post: Post, status: PostStatus) =>
  LANGS.some((lang) => post.versions[lang]?.status === status);

export const isPublished = (post: Post): boolean => hasStatus(post, "published");
export const isLive = (post: Post): boolean =>
  hasStatus(post, "published") || hasStatus(post, "scheduled");
export const scheduledLangs = (post: Post): Lang[] =>
  LANGS.filter((lang) => post.versions[lang]?.status === "scheduled");

export function slugEntries(post: Post): Array<{ lang: Lang; slug: string }> {
  return LANGS.flatMap((lang) => {
    const version = post.versions[lang];
    return version ? [{ lang, slug: version.slug }] : [];
  });
}

/** What readers can see: published versions plus shared fields, or null when nothing is published. */
function publicView(post: Post | null): string | null {
  if (!post) return null;
  const published = LANGS.flatMap((lang) => {
    const version = post.versions[lang];
    return version?.status === "published" ? [[lang, version] as const] : [];
  });
  if (published.length === 0) return null;
  return JSON.stringify({ tags: post.tags, coverImage: post.coverImage, published });
}

export function needsRebuild(before: Post | null, after: Post | null): boolean {
  return publicView(before) !== publicView(after);
}

export function toSummary(post: Post): PostSummary {
  const versions: PostSummary["versions"] = {};
  for (const lang of LANGS) {
    const version = post.versions[lang];
    if (version) {
      const { content: _content, ...summary } = version;
      versions[lang] = summary;
    }
  }
  return { ...post, versions };
}
```

- [ ] **Step 4: Chạy test để thấy thành công**

Run: `pnpm --filter @blog/api exec vitest run test/domain`
Expected: PASS (gồm `slug.test.ts` không đổi).

- [ ] **Step 5: Commit**

```bash
pnpm format
git add services/api/src/domain services/api/test/domain
git commit -m "feat(api): bilingual post domain with public-view rebuild rule" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Port, fake, use case bài & bản ngôn ngữ

**Files:**
- Modify: `services/api/src/usecases/ports.ts`, `services/api/src/usecases/posts.ts` (thay toàn bộ)
- Create: `services/api/src/usecases/versions.ts`
- Modify: `services/api/test/fakes.ts` (thay toàn bộ)
- Test: `services/api/test/usecases/posts.test.ts` (thay toàn bộ), `services/api/test/usecases/versions.test.ts`
- Delete: `services/api/test/usecases/afterCommit.test.ts` (các trường hợp được chuyển vào `posts`/`versions`/`publishing` test)

**Interfaces:**
- Consumes: Task 1–2; `afterCommit`, `requestBuild` (Kế hoạch 1).
- Produces:
  - Ports: `TagRepository { list(): Promise<Tag[]>; put(tag: Tag): Promise<void> }`; `PublishScheduler { schedule(postId, lang, publishAt); cancel(postId, lang) }`; `Deps.tags: TagRepository`. `PostRepository` giữ nguyên chữ ký; hợp đồng `create`/`update` nay ném `SLUG_TAKEN` khi **bất kỳ** slug nào của bài trùng một slug khác trên toàn site.
  - `interface Caller { e2e: boolean }`, `assertCallerMayModify(post, caller)`
  - `listPosts`, `getPost`, `createPost(deps, input)`, `updatePost(deps, id, input: UpdatePostInput, caller?)`, `deletePost(deps, id, caller?)`
  - `upsertVersion(deps, id, lang, input: UpsertVersionInput, caller?)`, `deleteVersion(deps, id, lang, caller?)`
  - Fakes: `InMemoryTagRepository`, `RecordingScheduler` dùng khoá `"<postId>:<lang>"`, `makeDeps()` có `tags`.

- [ ] **Step 1: Cập nhật ports**

`services/api/src/usecases/ports.ts` (thay toàn bộ):
```ts
import type { BuildState, ImageContentType, Lang, Post, Tag } from "@blog/shared";

export interface PostRepository {
  get(id: string): Promise<Post | null>;
  /** Newest `updatedAt` first. */
  list(): Promise<Post[]>;
  /** Throws SLUG_TAKEN when any slug of the post is already used anywhere on the site. */
  create(post: Post): Promise<void>;
  /** Throws VERSION_CONFLICT when the stored version is not `prev.version`, SLUG_TAKEN on slug clash. */
  update(next: Post, prev: Post): Promise<void>;
  delete(post: Post): Promise<void>;
}

export interface TagRepository {
  /** Tags that have names, sorted by key. */
  list(): Promise<Tag[]>;
  put(tag: Tag): Promise<void>;
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
  /** Creates or replaces the one-time schedule for one language version. */
  schedule(postId: string, lang: Lang, publishAt: string): Promise<void>;
  /** Removes the schedule; succeeds when it does not exist. */
  cancel(postId: string, lang: Lang): Promise<void>;
}

export interface UploadSigner {
  sign(
    key: string,
    contentType: ImageContentType,
  ): Promise<{ url: string; fields: Record<string, string> }>;
}

export interface Log {
  error(message: string, attributes: Record<string, unknown>): void;
}

export interface Deps {
  posts: PostRepository;
  tags: TagRepository;
  builds: BuildStatusRepository;
  buildQueue: BuildQueue;
  scheduler: PublishScheduler;
  uploads: UploadSigner;
  log: Log;
  now: () => string;
  newId: () => string;
  /** e.g. "https://blog.oki-dev.xyz", no trailing slash */
  blogBaseUrl: string;
}
```

- [ ] **Step 2: Cập nhật fakes**

`services/api/test/fakes.ts` (thay toàn bộ):
```ts
import type { BuildState, ImageContentType, Lang, Post, Tag } from "@blog/shared";
import { DomainError } from "../src/domain/errors";
import { slugEntries } from "../src/domain/post";
import type {
  BuildQueue,
  BuildStatusRepository,
  Deps,
  PostRepository,
  PublishScheduler,
  TagRepository,
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
    this.assertSlugsFree(post);
    this.items.set(post.id, structuredClone(post));
  }

  async update(next: Post, prev: Post) {
    const current = this.items.get(prev.id);
    if (!current || current.version !== prev.version) {
      throw new DomainError("VERSION_CONFLICT", "post was modified elsewhere");
    }
    this.assertSlugsFree(next);
    this.items.set(next.id, structuredClone(next));
  }

  async delete(post: Post) {
    this.items.delete(post.id);
  }

  /** Mirrors the site-wide SLUG#<slug> reservations of the DynamoDB repository. */
  private assertSlugsFree(post: Post) {
    const mine = slugEntries(post).map((e) => e.slug);
    const taken = (slug: string) => new DomainError("SLUG_TAKEN", `slug "${slug}" is already used`);
    const duplicate = mine.find((slug, i) => mine.indexOf(slug) !== i);
    if (duplicate) throw taken(duplicate);
    for (const other of this.items.values()) {
      if (other.id === post.id) continue;
      for (const { slug } of slugEntries(other)) if (mine.includes(slug)) throw taken(slug);
    }
  }
}

export class InMemoryTagRepository implements TagRepository {
  readonly items = new Map<string, Tag>();

  async list() {
    return [...this.items.values()].sort((a, b) => a.key.localeCompare(b.key)).map((t) => structuredClone(t));
  }

  async put(tag: Tag) {
    this.items.set(tag.key, structuredClone(tag));
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

/** Keys are "<postId>:<lang>". */
export class RecordingScheduler implements PublishScheduler {
  readonly scheduled = new Map<string, string>();
  readonly cancelled: string[] = [];
  failWith: Error | null = null;
  cancelFailWith: Error | null = null;

  async schedule(postId: string, lang: Lang, publishAt: string) {
    if (this.failWith) throw this.failWith;
    this.scheduled.set(`${postId}:${lang}`, publishAt);
  }

  async cancel(postId: string, lang: Lang) {
    if (this.cancelFailWith) throw this.cancelFailWith;
    this.scheduled.delete(`${postId}:${lang}`);
    this.cancelled.push(`${postId}:${lang}`);
  }
}

export class FakeUploadSigner implements UploadSigner {
  async sign(key: string, contentType: ImageContentType) {
    return { url: "https://uploads.example", fields: { key, "Content-Type": contentType } };
  }
}

export class RecordingLog {
  readonly errors: Array<{ message: string; attributes: Record<string, unknown> }> = [];

  error(message: string, attributes: Record<string, unknown>) {
    this.errors.push({ message, attributes });
  }
}

export interface TestDeps extends Deps {
  posts: InMemoryPostRepository;
  tags: InMemoryTagRepository;
  builds: FakeBuildStatusRepository;
  buildQueue: RecordingBuildQueue;
  scheduler: RecordingScheduler;
  log: RecordingLog;
  /** Change to move the fake clock. */
  clock: { now: string };
}

export function makeDeps(): TestDeps {
  let seq = 0;
  const clock = { now: "2026-10-10T00:00:00.000Z" };
  return {
    posts: new InMemoryPostRepository(),
    tags: new InMemoryTagRepository(),
    builds: new FakeBuildStatusRepository(),
    buildQueue: new RecordingBuildQueue(),
    scheduler: new RecordingScheduler(),
    uploads: new FakeUploadSigner(),
    log: new RecordingLog(),
    clock,
    now: () => clock.now,
    newId: () => `01J${String(++seq).padStart(23, "0")}`,
    blogBaseUrl: "https://blog.oki-dev.xyz",
  };
}
```

- [ ] **Step 3: Viết test thất bại**

`services/api/test/usecases/posts.test.ts` (thay toàn bộ):
```ts
import { describe, expect, it } from "vitest";
import { createPost, deletePost, getPost, listPosts, updatePost } from "../../src/usecases/posts";
import { publishVersion } from "../../src/usecases/publishing";
import { upsertVersion } from "../../src/usecases/versions";
import { makeDeps } from "../fakes";

const FUTURE = { publishAt: "2026-10-12T08:00:00Z" };
const E2E = { e2e: true };

const create = (deps: ReturnType<typeof makeDeps>, title = "Học AWS") =>
  createPost(deps, { lang: "vi", title, excerpt: "", content: "body", tags: [], coverImage: null });

describe("createPost / getPost / listPosts", () => {
  it("stores a post with one vi draft", async () => {
    const deps = makeDeps();
    const created = await create(deps);
    expect(await getPost(deps, created.id)).toEqual(created);
    expect(created.versions.vi?.status).toBe("draft");
  });

  it("rejects a second post with the same slug", async () => {
    const deps = makeDeps();
    await create(deps);
    await expect(create(deps)).rejects.toMatchObject({ code: "SLUG_TAKEN" });
  });

  it("throws NOT_FOUND for an unknown id", async () => {
    await expect(getPost(makeDeps(), "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lists summaries without content, newest update first", async () => {
    const deps = makeDeps();
    const first = await create(deps, "First");
    deps.clock.now = "2026-10-11T00:00:00.000Z";
    const second = await create(deps, "Second");
    const list = await listPosts(deps);
    expect(list.map((p) => p.id)).toEqual([second.id, first.id]);
    expect(list[0]?.versions.vi).not.toHaveProperty("content");
  });
});

describe("updatePost (shared fields)", () => {
  it("does not build for a draft-only post", async () => {
    const deps = makeDeps();
    const post = await create(deps);
    const next = await updatePost(deps, post.id, { tags: ["life"], coverImage: null, version: 1 });
    expect(next.tags).toEqual(["life"]);
    expect(deps.buildQueue.reasons).toEqual([]);
  });

  it("builds when the post has a published version", async () => {
    const deps = makeDeps();
    const post = await create(deps);
    const published = await publishVersion(deps, post.id, "vi", {});
    deps.buildQueue.reasons.length = 0;
    await updatePost(deps, post.id, { tags: ["life"], coverImage: null, version: published.version });
    expect(deps.buildQueue.reasons).toEqual([`update:${post.id}`]);
  });

  it("returns the saved post when the build queue is down", async () => {
    const deps = makeDeps();
    const post = await create(deps);
    const published = await publishVersion(deps, post.id, "vi", {});
    deps.buildQueue.failWith = new Error("SQS down");
    const saved = await updatePost(deps, post.id, { tags: [], coverImage: null, version: published.version });
    expect((await getPost(deps, post.id)).version).toBe(saved.version);
    expect(deps.builds.state.status).toBe("failed");
    expect(deps.log.errors).toHaveLength(1);
  });

  it("rejects a stale version", async () => {
    const deps = makeDeps();
    const post = await create(deps);
    await updatePost(deps, post.id, { tags: [], coverImage: null, version: 1 });
    await expect(
      updatePost(deps, post.id, { tags: [], coverImage: null, version: 1 }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });
});

describe("deletePost", () => {
  it("deletes a draft-only post without building", async () => {
    const deps = makeDeps();
    const post = await create(deps);
    await deletePost(deps, post.id);
    await expect(getPost(deps, post.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(deps.buildQueue.reasons).toEqual([]);
  });

  it("cancels every scheduled version and builds when something was published", async () => {
    const deps = makeDeps();
    const post = await create(deps);
    const p1 = await publishVersion(deps, post.id, "vi", {});
    const p2 = await upsertVersion(deps, post.id, "ja", { title: "AWS", excerpt: "", content: "", version: p1.version });
    await publishVersion(deps, post.id, "ja", FUTURE);
    deps.buildQueue.reasons.length = 0;
    expect(p2.versions.ja).toBeDefined();
    await deletePost(deps, post.id);
    expect(deps.scheduler.cancelled).toEqual([`${post.id}:ja`]);
    expect(deps.buildQueue.reasons).toEqual([`delete:${post.id}`]);
  });

  it("succeeds when cancelling the schedule fails", async () => {
    const deps = makeDeps();
    const post = await create(deps);
    await publishVersion(deps, post.id, "vi", FUTURE);
    deps.scheduler.cancelFailWith = new Error("throttled");
    await deletePost(deps, post.id);
    await expect(getPost(deps, post.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(deps.log.errors).toHaveLength(1);
  });
});

describe("e2e caller", () => {
  it("may edit and delete a post with nothing published or scheduled", async () => {
    const deps = makeDeps();
    const post = await create(deps);
    await updatePost(deps, post.id, { tags: [], coverImage: null, version: 1 }, E2E);
    await deletePost(deps, post.id, E2E);
  });

  it.each([
    ["published", {}],
    ["scheduled", FUTURE],
  ])("may not edit or delete a post with a %s version", async (_s, body) => {
    const deps = makeDeps();
    const post = await create(deps);
    const live = await publishVersion(deps, post.id, "vi", body);
    await expect(
      updatePost(deps, post.id, { tags: [], coverImage: null, version: live.version }, E2E),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(deletePost(deps, post.id, E2E)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
```

`services/api/test/usecases/versions.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createPost, getPost } from "../../src/usecases/posts";
import { publishVersion } from "../../src/usecases/publishing";
import { deleteVersion, upsertVersion } from "../../src/usecases/versions";
import { makeDeps } from "../fakes";

const FUTURE = { publishAt: "2026-10-12T08:00:00Z" };

const setup = async () => {
  const deps = makeDeps();
  const post = await createPost(deps, {
    lang: "vi",
    title: "Học AWS",
    excerpt: "",
    content: "",
    tags: [],
    coverImage: null,
  });
  return { deps, post };
};
const ja = (version: number, extra: Record<string, string> = {}) => ({
  title: "AWSを学ぶ",
  excerpt: "",
  content: "本文",
  version,
  ...extra,
});

describe("upsertVersion", () => {
  it("adds a ja draft without building", async () => {
    const { deps, post } = await setup();
    const next = await upsertVersion(deps, post.id, "ja", ja(1));
    expect(next.versions.ja?.status).toBe("draft");
    expect(deps.buildQueue.reasons).toEqual([]);
  });

  it("does not build while editing a ja draft of a post whose vi is published", async () => {
    const { deps, post } = await setup();
    const published = await publishVersion(deps, post.id, "vi", {});
    const withJa = await upsertVersion(deps, post.id, "ja", ja(published.version));
    deps.buildQueue.reasons.length = 0;
    await upsertVersion(deps, post.id, "ja", ja(withJa.version, { content: "もっと" }));
    expect(deps.buildQueue.reasons).toEqual([]);
  });

  it("builds when a published version is edited", async () => {
    const { deps, post } = await setup();
    const published = await publishVersion(deps, post.id, "vi", {});
    deps.buildQueue.reasons.length = 0;
    await upsertVersion(deps, post.id, "vi", { title: "Mới", excerpt: "", content: "x", version: published.version });
    expect(deps.buildQueue.reasons).toEqual([`update:${post.id}:vi`]);
  });

  it("rejects a ja slug already used by another post's vi version", async () => {
    const { deps } = await setup();
    const other = await createPost(deps, {
      lang: "vi",
      title: "Khác",
      excerpt: "",
      content: "",
      tags: [],
      coverImage: null,
    });
    await expect(
      upsertVersion(deps, other.id, "ja", ja(1, { slug: "hoc-aws" })),
    ).rejects.toMatchObject({ code: "SLUG_TAKEN" });
  });

  it("rejects a ja slug equal to the same post's vi slug", async () => {
    const { deps, post } = await setup();
    await expect(
      upsertVersion(deps, post.id, "ja", ja(1, { slug: "hoc-aws" })),
    ).rejects.toMatchObject({ code: "SLUG_TAKEN" });
  });

  it("forbids the e2e caller on a post with a published version", async () => {
    const { deps, post } = await setup();
    const published = await publishVersion(deps, post.id, "vi", {});
    await expect(
      upsertVersion(deps, post.id, "ja", ja(published.version), { e2e: true }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("deleteVersion", () => {
  it("removes one of two versions", async () => {
    const { deps, post } = await setup();
    await upsertVersion(deps, post.id, "ja", ja(1));
    await deleteVersion(deps, post.id, "ja");
    expect((await getPost(deps, post.id)).versions.ja).toBeUndefined();
  });

  it("refuses to delete the only version", async () => {
    const { deps, post } = await setup();
    await expect(deleteVersion(deps, post.id, "vi")).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("cancels the schedule of a scheduled version without building", async () => {
    const { deps, post } = await setup();
    await upsertVersion(deps, post.id, "ja", ja(1));
    await publishVersion(deps, post.id, "ja", FUTURE);
    await deleteVersion(deps, post.id, "ja");
    expect(deps.scheduler.cancelled).toEqual([`${post.id}:ja`]);
    expect(deps.buildQueue.reasons).toEqual([]);
  });

  it("builds when a published version is deleted", async () => {
    const { deps, post } = await setup();
    const withJa = await upsertVersion(deps, post.id, "ja", ja(1));
    await publishVersion(deps, post.id, "ja", {});
    deps.buildQueue.reasons.length = 0;
    expect(withJa.versions.ja).toBeDefined();
    await deleteVersion(deps, post.id, "ja");
    expect(deps.buildQueue.reasons).toEqual([`delete:${post.id}:ja`]);
  });
});
```

> `posts.test.ts`/`versions.test.ts` dùng `publishVersion` của Task 4. Step 5 thêm bản tối thiểu; Task 4 thay toàn bộ file.

- [ ] **Step 4: Chạy test để thấy thất bại**

Run: `rm services/api/test/usecases/afterCommit.test.ts && pnpm --filter @blog/api exec vitest run test/usecases/posts.test.ts test/usecases/versions.test.ts`
Expected: FAIL — không resolve được `../../src/usecases/versions`, `publishVersion` không được export.

- [ ] **Step 5: Viết mã**

`services/api/src/usecases/posts.ts` (thay toàn bộ):
```ts
import type { CreatePostInput, Post, PostSummary, UpdatePostInput } from "@blog/shared";
import { DomainError, notFound } from "../domain/errors";
import { isLive, needsRebuild, newPost, scheduledLangs, toSummary, updateShared } from "../domain/post";
import { afterCommit } from "./afterCommit";
import { requestBuild } from "./builds";
import type { Deps } from "./ports";

export interface Caller {
  /** The e2e test account may only touch posts with nothing published or scheduled. */
  e2e: boolean;
}

export const AUTHOR: Caller = { e2e: false };

export function assertCallerMayModify(post: Post, caller: Caller) {
  if (caller.e2e && isLive(post)) {
    throw new DomainError(
      "FORBIDDEN",
      "the e2e account can only modify posts with nothing published or scheduled",
    );
  }
}

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

export async function updatePost(
  deps: Deps,
  id: string,
  input: UpdatePostInput,
  caller: Caller = AUTHOR,
): Promise<Post> {
  const prev = await getPost(deps, id);
  assertCallerMayModify(prev, caller);
  const next = updateShared(prev, input, deps.now());
  await deps.posts.update(next, prev);
  if (needsRebuild(prev, next)) {
    await afterCommit(deps, "build request", () => requestBuild(deps, `update:${id}`));
  }
  return next;
}

export async function deletePost(deps: Deps, id: string, caller: Caller = AUTHOR): Promise<void> {
  const prev = await getPost(deps, id);
  assertCallerMayModify(prev, caller);
  // Delete first: if cancelling then fails, the orphan schedule finds no post and is skipped.
  await deps.posts.delete(prev);
  for (const lang of scheduledLangs(prev)) {
    await afterCommit(deps, "schedule cancel", () => deps.scheduler.cancel(id, lang));
  }
  if (needsRebuild(prev, null)) {
    await afterCommit(deps, "build request", () => requestBuild(deps, `delete:${id}`));
  }
}
```

`services/api/src/usecases/versions.ts`:
```ts
import type { Lang, Post, UpsertVersionInput } from "@blog/shared";
import { applyVersion, needsRebuild, withoutVersion } from "../domain/post";
import { afterCommit } from "./afterCommit";
import { requestBuild } from "./builds";
import type { Deps } from "./ports";
import { AUTHOR, assertCallerMayModify, type Caller, getPost } from "./posts";

export async function upsertVersion(
  deps: Deps,
  id: string,
  lang: Lang,
  input: UpsertVersionInput,
  caller: Caller = AUTHOR,
): Promise<Post> {
  const prev = await getPost(deps, id);
  assertCallerMayModify(prev, caller);
  const next = applyVersion(prev, lang, input, deps.now());
  await deps.posts.update(next, prev);
  if (needsRebuild(prev, next)) {
    await afterCommit(deps, "build request", () => requestBuild(deps, `update:${id}:${lang}`));
  }
  return next;
}

export async function deleteVersion(
  deps: Deps,
  id: string,
  lang: Lang,
  caller: Caller = AUTHOR,
): Promise<Post> {
  const prev = await getPost(deps, id);
  assertCallerMayModify(prev, caller);
  const next = withoutVersion(prev, lang, deps.now());
  await deps.posts.update(next, prev);
  if (prev.versions[lang]?.status === "scheduled") {
    await afterCommit(deps, "schedule cancel", () => deps.scheduler.cancel(id, lang));
  }
  if (needsRebuild(prev, next)) {
    await afterCommit(deps, "build request", () => requestBuild(deps, `delete:${id}:${lang}`));
  }
  return next;
}
```

`services/api/src/usecases/publishing.ts` (bản tối thiểu, Task 4 thay toàn bộ):
```ts
import type { Lang, Post, PublishInput } from "@blog/shared";
import { needsRebuild, publish } from "../domain/post";
import { afterCommit } from "./afterCommit";
import { requestBuild } from "./builds";
import type { Deps } from "./ports";
import { getPost } from "./posts";

export async function publishVersion(
  deps: Deps,
  id: string,
  lang: Lang,
  input: PublishInput,
): Promise<Post> {
  const prev = await getPost(deps, id);
  const next = publish(prev, lang, input.publishAt, deps.now());
  await deps.posts.update(next, prev);
  const version = next.versions[lang];
  if (version?.status === "scheduled" && version.publishAt) {
    await deps.scheduler.schedule(id, lang, version.publishAt);
  } else if (needsRebuild(prev, next)) {
    await afterCommit(deps, "build request", () => requestBuild(deps, `publish:${id}:${lang}`));
  }
  return next;
}
```

- [ ] **Step 6: Chạy test để thấy thành công**

Run: `pnpm --filter @blog/api exec vitest run test/domain test/usecases/posts.test.ts test/usecases/versions.test.ts test/usecases/builds.test.ts test/usecases/uploads.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
pnpm format
git add -A services/api/src/usecases services/api/test
git commit -m "feat(api): bilingual post and version use cases with e2e guard" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Đăng / gỡ / đăng theo lịch theo từng ngôn ngữ

**Files:**
- Modify: `services/api/src/usecases/publishing.ts` (thay toàn bộ), `services/api/src/events.ts`
- Test: `services/api/test/usecases/publishing.test.ts` (thay toàn bộ)

**Interfaces:**
- Consumes: Task 1–3.
- Produces:
  - `publishVersion(deps, id, lang, input: PublishInput): Promise<Post>`
  - `unpublishVersion(deps, id, lang): Promise<Post>`
  - `runScheduledPublish(deps, event: { postId; lang: Lang; publishAt }): Promise<"published" | "skipped">`
  - `events.ts`: `scheduledPublishEventSchema` có `lang: langSchema`; `ScheduledPublishEvent = { type: "scheduled-publish"; postId; lang; publishAt }`; `isScheduledPublishEvent` không đổi.

- [ ] **Step 1: Viết test thất bại**

`services/api/test/usecases/publishing.test.ts` (thay toàn bộ):
```ts
import { describe, expect, it } from "vitest";
import { createPost, getPost } from "../../src/usecases/posts";
import { publishVersion, runScheduledPublish, unpublishVersion } from "../../src/usecases/publishing";
import { deleteVersion, upsertVersion } from "../../src/usecases/versions";
import { makeDeps } from "../fakes";

const FUTURE = { publishAt: "2026-10-12T08:00:00Z" };
const AT = "2026-10-12T08:00:00.000Z";

const setup = async () => {
  const deps = makeDeps();
  const post = await createPost(deps, {
    lang: "vi",
    title: "Học AWS",
    excerpt: "",
    content: "",
    tags: [],
    coverImage: null,
  });
  return { deps, post };
};

describe("publishVersion", () => {
  it("publishes vi now and builds", async () => {
    const { deps, post } = await setup();
    const next = await publishVersion(deps, post.id, "vi", {});
    expect(next.versions.vi?.status).toBe("published");
    expect(deps.buildQueue.reasons).toEqual([`publish:${post.id}:vi`]);
  });

  it("schedules one language without building", async () => {
    const { deps, post } = await setup();
    await publishVersion(deps, post.id, "vi", FUTURE);
    expect(deps.scheduler.scheduled.get(`${post.id}:vi`)).toBe(AT);
    expect(deps.buildQueue.reasons).toEqual([]);
  });

  it("cancels the schedule and builds when a scheduled version is published now", async () => {
    const { deps, post } = await setup();
    await publishVersion(deps, post.id, "vi", FUTURE);
    await publishVersion(deps, post.id, "vi", {});
    expect(deps.scheduler.cancelled).toEqual([`${post.id}:vi`]);
    expect(deps.buildQueue.reasons).toEqual([`publish:${post.id}:vi`]);
  });

  it("still builds when cancelling the old schedule fails", async () => {
    const { deps, post } = await setup();
    await publishVersion(deps, post.id, "vi", FUTURE);
    deps.scheduler.cancelFailWith = new Error("throttled");
    await publishVersion(deps, post.id, "vi", {});
    expect(deps.buildQueue.reasons).toEqual([`publish:${post.id}:vi`]);
    expect(deps.log.errors).toHaveLength(1);
  });

  it("reverts the post when the schedule cannot be created", async () => {
    const { deps, post } = await setup();
    deps.scheduler.failWith = new Error("Scheduler down");
    await expect(publishVersion(deps, post.id, "vi", FUTURE)).rejects.toThrow("Scheduler down");
    expect((await getPost(deps, post.id)).versions.vi?.status).toBe("draft");
  });

  it("logs when the revert itself fails", async () => {
    const { deps, post } = await setup();
    deps.scheduler.failWith = new Error("Scheduler down");
    const realUpdate = deps.posts.update.bind(deps.posts);
    let calls = 0;
    deps.posts.update = async (next, prev) => {
      calls += 1;
      if (calls === 2) throw new Error("DynamoDB down");
      return realUpdate(next, prev);
    };
    await expect(publishVersion(deps, post.id, "vi", FUTURE)).rejects.toThrow("Scheduler down");
    expect(deps.log.errors).toHaveLength(1);
  });
});

describe("unpublishVersion", () => {
  it("takes a published version down and builds", async () => {
    const { deps, post } = await setup();
    await publishVersion(deps, post.id, "vi", {});
    deps.buildQueue.reasons.length = 0;
    expect((await unpublishVersion(deps, post.id, "vi")).versions.vi?.status).toBe("draft");
    expect(deps.buildQueue.reasons).toEqual([`unpublish:${post.id}:vi`]);
  });

  it("cancels a schedule without building, even if cancelling fails", async () => {
    const { deps, post } = await setup();
    await publishVersion(deps, post.id, "vi", FUTURE);
    deps.scheduler.cancelFailWith = new Error("throttled");
    expect((await unpublishVersion(deps, post.id, "vi")).versions.vi?.status).toBe("draft");
    expect(deps.buildQueue.reasons).toEqual([]);
    expect(deps.log.errors).toHaveLength(1);
  });
});

describe("runScheduledPublish", () => {
  it("publishes the matching language and builds", async () => {
    const { deps, post } = await setup();
    const withJa = await upsertVersion(deps, post.id, "ja", { title: "AWS", excerpt: "", content: "", version: 1 });
    expect(withJa.versions.ja).toBeDefined();
    await publishVersion(deps, post.id, "ja", FUTURE);
    const result = await runScheduledPublish(deps, { postId: post.id, lang: "ja", publishAt: AT });
    expect(result).toBe("published");
    const stored = await getPost(deps, post.id);
    expect(stored.versions.ja?.status).toBe("published");
    expect(stored.versions.vi?.status).toBe("draft");
    expect(deps.buildQueue.reasons).toEqual([`scheduled:${post.id}:ja`]);
  });

  it("skips an event for the other language", async () => {
    const { deps, post } = await setup();
    await publishVersion(deps, post.id, "vi", FUTURE);
    expect(await runScheduledPublish(deps, { postId: post.id, lang: "ja", publishAt: AT })).toBe("skipped");
  });

  it("skips a stale event after rescheduling", async () => {
    const { deps, post } = await setup();
    await publishVersion(deps, post.id, "vi", FUTURE);
    await publishVersion(deps, post.id, "vi", { publishAt: "2026-10-13T08:00:00Z" });
    expect(await runScheduledPublish(deps, { postId: post.id, lang: "vi", publishAt: AT })).toBe("skipped");
    expect(deps.buildQueue.reasons).toEqual([]);
  });

  it("skips when the version or the post is gone", async () => {
    const { deps, post } = await setup();
    const withJa = await upsertVersion(deps, post.id, "ja", { title: "AWS", excerpt: "", content: "", version: 1 });
    expect(withJa.versions.ja).toBeDefined();
    await publishVersion(deps, post.id, "ja", FUTURE);
    await deleteVersion(deps, post.id, "ja");
    expect(await runScheduledPublish(deps, { postId: post.id, lang: "ja", publishAt: AT })).toBe("skipped");
    expect(await runScheduledPublish(deps, { postId: "gone", lang: "vi", publishAt: AT })).toBe("skipped");
  });

  it("rethrows VERSION_CONFLICT so the invocation is retried, without building", async () => {
    const { deps, post } = await setup();
    await publishVersion(deps, post.id, "vi", FUTURE);
    const realGet = deps.posts.get.bind(deps.posts);
    deps.posts.get = async (id) => {
      const snapshot = await realGet(id);
      const stored = deps.posts.items.get(id);
      if (stored) stored.version += 1; // an autosave lands between read and write
      return snapshot;
    };
    await expect(
      runScheduledPublish(deps, { postId: post.id, lang: "vi", publishAt: AT }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(deps.buildQueue.reasons).toEqual([]);
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `pnpm --filter @blog/api exec vitest run test/usecases/publishing.test.ts`
Expected: FAIL — `unpublishVersion`/`runScheduledPublish` không được export.

- [ ] **Step 3: Viết mã**

`services/api/src/events.ts` (thay toàn bộ):
```ts
import { langSchema } from "@blog/shared";
import { z } from "zod";

export const scheduledPublishEventSchema = z.object({
  type: z.literal("scheduled-publish"),
  postId: z.string().min(1),
  lang: langSchema,
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

`services/api/src/usecases/publishing.ts` (thay toàn bộ):
```ts
import type { Lang, Post, PublishInput } from "@blog/shared";
import { needsRebuild, publish, publishScheduled, unpublish } from "../domain/post";
import { afterCommit } from "./afterCommit";
import { requestBuild } from "./builds";
import type { Deps } from "./ports";
import { getPost } from "./posts";

export async function publishVersion(
  deps: Deps,
  id: string,
  lang: Lang,
  input: PublishInput,
): Promise<Post> {
  const prev = await getPost(deps, id);
  const next = publish(prev, lang, input.publishAt, deps.now());
  await deps.posts.update(next, prev);

  const version = next.versions[lang];
  if (version?.status === "scheduled" && version.publishAt) {
    try {
      await deps.scheduler.schedule(id, lang, version.publishAt);
    } catch (err) {
      // Do not leave a "scheduled" version without a schedule: restore the previous state.
      await deps.posts
        .update({ ...prev, updatedAt: deps.now(), version: next.version + 1 }, next)
        .catch((error) =>
          deps.log.error("revert after failed schedule failed", { error, postId: id, lang }),
        );
      throw err;
    }
    return next;
  }

  if (prev.versions[lang]?.status === "scheduled") {
    await afterCommit(deps, "schedule cancel", () => deps.scheduler.cancel(id, lang));
  }
  if (needsRebuild(prev, next)) {
    await afterCommit(deps, "build request", () => requestBuild(deps, `publish:${id}:${lang}`));
  }
  return next;
}

export async function unpublishVersion(deps: Deps, id: string, lang: Lang): Promise<Post> {
  const prev = await getPost(deps, id);
  const next = unpublish(prev, lang, deps.now());
  await deps.posts.update(next, prev);
  // If cancelling fails, the stale schedule is skipped by runScheduledPublish.
  if (prev.versions[lang]?.status === "scheduled") {
    await afterCommit(deps, "schedule cancel", () => deps.scheduler.cancel(id, lang));
  }
  if (needsRebuild(prev, next)) {
    await afterCommit(deps, "build request", () => requestBuild(deps, `unpublish:${id}:${lang}`));
  }
  return next;
}

/**
 * Called by EventBridge Scheduler (asynchronous Lambda invoke). Throwing hands the event to
 * Lambda's async retries, e.g. on VERSION_CONFLICT; stale events return "skipped".
 */
export async function runScheduledPublish(
  deps: Deps,
  event: { postId: string; lang: Lang; publishAt: string },
): Promise<"published" | "skipped"> {
  const prev = await deps.posts.get(event.postId);
  if (!prev) return "skipped";
  const next = publishScheduled(prev, event.lang, event.publishAt, deps.now());
  if (!next) return "skipped";
  await deps.posts.update(next, prev);
  await afterCommit(deps, "build request", () =>
    requestBuild(deps, `scheduled:${event.postId}:${event.lang}`),
  );
  return "published";
}
```

- [ ] **Step 4: Chạy test để thấy thành công**

Run: `pnpm --filter @blog/api exec vitest run test/domain test/usecases`
Expected: PASS (mọi file trong `test/usecases`, trừ `tags.test.ts` chưa tồn tại).

- [ ] **Step 5: Commit**

```bash
pnpm format
git add services/api/src services/api/test/usecases
git commit -m "feat(api): per-language publish, unpublish and scheduled publish" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Use case tag

**Files:**
- Create: `services/api/src/usecases/tags.ts`
- Test: `services/api/test/usecases/tags.test.ts`

**Interfaces:**
- Consumes: Task 1–4 (`isLive`, `isPublished`, `isValidSlug`, `Caller`, `AUTHOR`).
- Produces: `listTags(deps): Promise<TagSummary[]>` (sắp xếp theo `key`), `putTag(deps, key, input: PutTagInput, caller?): Promise<Tag>`.

- [ ] **Step 1: Viết test thất bại**

`services/api/test/usecases/tags.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createPost } from "../../src/usecases/posts";
import { publishVersion } from "../../src/usecases/publishing";
import { listTags, putTag } from "../../src/usecases/tags";
import { makeDeps } from "../fakes";

const post = (deps: ReturnType<typeof makeDeps>, title: string, tags: string[]) =>
  createPost(deps, { lang: "vi", title, excerpt: "", content: "", tags, coverImage: null });

describe("listTags", () => {
  it("merges tags used by posts with named tags and counts posts", async () => {
    const deps = makeDeps();
    await post(deps, "A", ["aws", "life"]);
    await post(deps, "B", ["life"]);
    await deps.tags.put({ key: "life", names: { vi: "đời sống", ja: "暮らし" } });
    await deps.tags.put({ key: "travel", names: { ja: "旅" } });
    expect(await listTags(deps)).toEqual([
      { key: "aws", names: {}, postCount: 1 },
      { key: "life", names: { vi: "đời sống", ja: "暮らし" }, postCount: 2 },
      { key: "travel", names: { ja: "旅" }, postCount: 0 },
    ]);
  });
});

describe("putTag", () => {
  it("stores names for a valid key", async () => {
    const deps = makeDeps();
    const tag = await putTag(deps, "life", { names: { ja: "暮らし" } });
    expect(tag).toEqual({ key: "life", names: { ja: "暮らし" } });
    expect(await deps.tags.list()).toEqual([tag]);
  });

  it("rejects an invalid key", async () => {
    await expect(putTag(makeDeps(), "Bad Key", { names: {} })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("builds only when a post with a published version uses the tag", async () => {
    const deps = makeDeps();
    const draft = await post(deps, "Draft", ["life"]);
    await putTag(deps, "life", { names: { vi: "đời sống" } });
    expect(deps.buildQueue.reasons).toEqual([]);
    await publishVersion(deps, draft.id, "vi", {});
    deps.buildQueue.reasons.length = 0;
    await putTag(deps, "life", { names: { vi: "cuộc sống" } });
    expect(deps.buildQueue.reasons).toEqual(["tag:life"]);
  });

  it("forbids the e2e caller on a tag used by a live post, allows it otherwise", async () => {
    const deps = makeDeps();
    const live = await post(deps, "Live", ["life"]);
    await post(deps, "Draft", ["e2e-tag"]);
    await publishVersion(deps, live.id, "vi", { publishAt: "2026-10-12T08:00:00Z" });
    await expect(putTag(deps, "life", { names: { vi: "x" } }, { e2e: true })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(putTag(deps, "e2e-tag", { names: { vi: "x" } }, { e2e: true })).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `pnpm --filter @blog/api exec vitest run test/usecases/tags.test.ts`
Expected: FAIL — không resolve được `../../src/usecases/tags`.

- [ ] **Step 3: Viết mã**

`services/api/src/usecases/tags.ts`:
```ts
import type { PutTagInput, Tag, TagSummary } from "@blog/shared";
import { DomainError } from "../domain/errors";
import { isLive, isPublished } from "../domain/post";
import { isValidSlug } from "../domain/slug";
import { afterCommit } from "./afterCommit";
import { requestBuild } from "./builds";
import type { Deps } from "./ports";
import { AUTHOR, type Caller } from "./posts";

export async function listTags(deps: Deps): Promise<TagSummary[]> {
  const [posts, named] = await Promise.all([deps.posts.list(), deps.tags.list()]);
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const key of post.tags) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const names = new Map(named.map((tag) => [tag.key, tag.names]));
  const keys = [...new Set([...counts.keys(), ...names.keys()])].sort();
  return keys.map((key) => ({ key, names: names.get(key) ?? {}, postCount: counts.get(key) ?? 0 }));
}

export async function putTag(
  deps: Deps,
  key: string,
  input: PutTagInput,
  caller: Caller = AUTHOR,
): Promise<Tag> {
  if (!isValidSlug(key)) {
    throw new DomainError("VALIDATION_ERROR", "tag key must be lowercase latin letters, digits and dashes");
  }
  const users = (await deps.posts.list()).filter((post) => post.tags.includes(key));
  if (caller.e2e && users.some(isLive)) {
    throw new DomainError("FORBIDDEN", "the e2e account cannot rename a tag used by a live post");
  }
  const tag: Tag = { key, names: input.names };
  await deps.tags.put(tag);
  if (users.some(isPublished)) {
    await afterCommit(deps, "build request", () => requestBuild(deps, `tag:${key}`));
  }
  return tag;
}
```

- [ ] **Step 4: Chạy test để thấy thành công**

Run: `pnpm --filter @blog/api exec vitest run test/domain test/usecases`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add services/api/src/usecases/tags.ts services/api/test/usecases/tags.test.ts
git commit -m "feat(api): tag listing and bilingual tag names" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: DynamoDB — nhiều slug mỗi bài, repository tag

**Files:**
- Modify: `services/api/src/adapters/dynamo/items.ts`, `services/api/src/adapters/dynamo/postRepo.ts` (thay toàn bộ), `services/api/test/fixtures.ts` (thay toàn bộ)
- Create: `services/api/src/adapters/dynamo/queryIndex.ts`, `services/api/src/adapters/dynamo/tagRepo.ts`
- Test: `services/api/test/adapters/postRepo.test.ts` (thay toàn bộ), `services/api/test/adapters/tagRepo.test.ts`

**Interfaces:**
- Consumes: `slugEntries` (Task 2), ports (Task 3).
- Produces:
  - `items.ts`: thêm `tagKey(key)`, `toTagItem(tag)`, `fromTagItem(item): Tag`; slug item nay là `{ PK: "SLUG#<slug>", SK: "SLUG", postId, lang }`.
  - `queryIndex(db, tableName, partition: "POST" | "TAG", newestFirst: boolean): Promise<Record<string, unknown>[]>`
  - `class DynamoPostRepository` (chữ ký không đổi), `class DynamoTagRepository implements TagRepository { constructor(db, tableName) }`
  - `test/fixtures.ts`: `samplePost(overrides?)` (một bản `vi`), `sampleVersion(overrides?)`

- [ ] **Step 1: Viết fixture và test thất bại**

`services/api/test/fixtures.ts` (thay toàn bộ):
```ts
import type { LangVersion, Post } from "@blog/shared";

export const sampleVersion = (overrides: Partial<LangVersion> = {}): LangVersion => ({
  slug: "hoc-aws",
  title: "Học AWS",
  excerpt: "",
  content: "# Hi",
  status: "draft",
  publishAt: null,
  publishedAt: null,
  updatedAt: "2026-10-10T00:00:00.000Z",
  ...overrides,
});

export const samplePost = (overrides: Partial<Post> = {}): Post => ({
  id: "01JABCDEFGHJKMNPQRSTVWXYZ0",
  tags: ["aws"],
  coverImage: null,
  createdAt: "2026-10-10T00:00:00.000Z",
  updatedAt: "2026-10-10T00:00:00.000Z",
  version: 1,
  versions: { vi: sampleVersion() },
  ...overrides,
});
```

`services/api/test/adapters/postRepo.test.ts` (thay toàn bộ):
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
const transactItems = () => ddb.commandCalls(TransactWriteCommand)[0]?.args[0].input.TransactItems ?? [];
const bilingual = (version = 1) =>
  samplePost({ version, versions: { vi: sampleVersion(), ja: sampleVersion({ slug: "aws-ja", title: "AWS" }) } });

beforeEach(() => ddb.reset());

describe("get / list", () => {
  it("returns null for a missing item and strips key attributes", async () => {
    ddb.on(GetCommand).resolvesOnce({}).resolvesOnce({ Item: toPostItem(samplePost()) });
    expect(await repo.get("x")).toBeNull();
    expect(await repo.get(ID)).toEqual(samplePost());
  });

  it("queries the byUpdated index for POST newest first and follows pagination", async () => {
    ddb
      .on(QueryCommand)
      .resolvesOnce({ Items: [toPostItem(samplePost({ id: "A" }))], LastEvaluatedKey: { PK: "POST#A" } })
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
    ddb.on(PutCommand).rejects(new ConditionalCheckFailedException({ message: "failed", $metadata: {} }));
    const prev = samplePost();
    await expect(repo.update({ ...prev, version: 2 }, prev)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
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
    const next = { ...prev, version: 2, versions: { ...prev.versions, vi: sampleVersion({ slug: "moi" }) } };
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
```

`services/api/test/adapters/tagRepo.test.ts`:
```ts
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
      .resolvesOnce({ Items: [toTagItem({ key: "aws", names: {} })], LastEvaluatedKey: { PK: "TAG#aws" } })
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
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `pnpm --filter @blog/api exec vitest run test/adapters/postRepo.test.ts test/adapters/tagRepo.test.ts`
Expected: FAIL — `toTagItem`/`DynamoTagRepository` không tồn tại; các test slug mới fail trên `postRepo` cũ.

- [ ] **Step 3: Viết mã**

`services/api/src/adapters/dynamo/items.ts` (thay toàn bộ):
```ts
import type { Post, Tag } from "@blog/shared";

export const POSTS_INDEX = "byUpdated";
export const postKey = (id: string) => ({ PK: `POST#${id}`, SK: "POST" });
export const slugKey = (slug: string) => ({ PK: `SLUG#${slug}`, SK: "SLUG" });
export const tagKey = (key: string) => ({ PK: `TAG#${key}`, SK: "TAG" });
export const BUILD_KEY = { PK: "BUILD", SK: "LATEST" } as const;

export function toPostItem(post: Post): Record<string, unknown> {
  return { ...postKey(post.id), GSI1PK: "POST", GSI1SK: post.updatedAt, ...post };
}

export function fromPostItem(item: Record<string, unknown>): Post {
  const { PK: _pk, SK: _sk, GSI1PK: _gpk, GSI1SK: _gsk, ...post } = item;
  return post as unknown as Post;
}

export function toTagItem(tag: Tag): Record<string, unknown> {
  return { ...tagKey(tag.key), GSI1PK: "TAG", GSI1SK: tag.key, key: tag.key, names: tag.names };
}

export function fromTagItem(item: Record<string, unknown>): Tag {
  return { key: item.key as string, names: (item.names as Tag["names"] | undefined) ?? {} };
}
```

`services/api/src/adapters/dynamo/queryIndex.ts`:
```ts
import { type DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { POSTS_INDEX } from "./items";

/** Reads every item of one GSI1 partition ("POST" or "TAG"), following pagination. */
export async function queryIndex(
  db: DynamoDBDocumentClient,
  tableName: string,
  partition: "POST" | "TAG",
  newestFirst: boolean,
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await db.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: POSTS_INDEX,
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": partition },
        ScanIndexForward: !newestFirst,
        ExclusiveStartKey: startKey,
      }),
    );
    items.push(...(res.Items ?? []));
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return items;
}
```

`services/api/src/adapters/dynamo/postRepo.ts` (thay toàn bộ):
```ts
import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
} from "@aws-sdk/client-dynamodb";
import {
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Lang, Post } from "@blog/shared";
import { DomainError } from "../../domain/errors";
import { slugEntries } from "../../domain/post";
import type { PostRepository } from "../../usecases/ports";
import { fromPostItem, postKey, slugKey, toPostItem } from "./items";
import { queryIndex } from "./queryIndex";

const versionConflict = () =>
  new DomainError("VERSION_CONFLICT", "post was modified elsewhere, reload and try again");
const slugTaken = (slug: string) =>
  new DomainError("SLUG_TAKEN", `slug "${slug}" is already used by another post or language`);

const firstFailed = (err: TransactionCanceledException) =>
  err.CancellationReasons?.findIndex((r) => r.Code === "ConditionalCheckFailed") ?? -1;

type SlugEntry = { lang: Lang; slug: string };

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
    return (await queryIndex(this.db, this.tableName, "POST", true)).map(fromPostItem);
  }

  async create(post: Post): Promise<void> {
    const slugs = slugEntries(post);
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
            ...slugs.map((entry) => this.reserve(post.id, entry)),
          ],
        }),
      );
    } catch (err) {
      if (err instanceof TransactionCanceledException) {
        const failed = slugs[firstFailed(err) - 1];
        if (failed) throw slugTaken(failed.slug);
      }
      throw err;
    }
  }

  async update(next: Post, prev: Post): Promise<void> {
    const before = new Map(slugEntries(prev).map((e) => [e.lang, e.slug]));
    const after = new Map(slugEntries(next).map((e) => [e.lang, e.slug]));
    const added = slugEntries(next).filter((e) => before.get(e.lang) !== e.slug);
    const removed = slugEntries(prev).filter((e) => after.get(e.lang) !== e.slug);

    const putPost = {
      TableName: this.tableName,
      Item: toPostItem(next),
      ConditionExpression: "#v = :v",
      ExpressionAttributeNames: { "#v": "version" },
      ExpressionAttributeValues: { ":v": prev.version },
    };

    if (added.length === 0 && removed.length === 0) {
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
            ...added.map((entry) => this.reserve(next.id, entry)),
            ...removed.map((entry) => ({
              Delete: { TableName: this.tableName, Key: slugKey(entry.slug) },
            })),
          ],
        }),
      );
    } catch (err) {
      if (err instanceof TransactionCanceledException) {
        const index = firstFailed(err);
        if (index === 0) throw versionConflict();
        const failed = added[index - 1];
        if (failed) throw slugTaken(failed.slug);
      }
      throw err;
    }
  }

  async delete(post: Post): Promise<void> {
    await this.db.send(
      new TransactWriteCommand({
        TransactItems: [
          { Delete: { TableName: this.tableName, Key: postKey(post.id) } },
          ...slugEntries(post).map((entry) => ({
            Delete: { TableName: this.tableName, Key: slugKey(entry.slug) },
          })),
        ],
      }),
    );
  }

  private reserve(postId: string, entry: SlugEntry) {
    return {
      Put: {
        TableName: this.tableName,
        Item: { ...slugKey(entry.slug), postId, lang: entry.lang },
        ConditionExpression: "attribute_not_exists(PK)",
      },
    };
  }
}
```

`services/api/src/adapters/dynamo/tagRepo.ts`:
```ts
import { type DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { Tag } from "@blog/shared";
import type { TagRepository } from "../../usecases/ports";
import { fromTagItem, toTagItem } from "./items";
import { queryIndex } from "./queryIndex";

export class DynamoTagRepository implements TagRepository {
  private readonly db: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(db: DynamoDBDocumentClient, tableName: string) {
    this.db = db;
    this.tableName = tableName;
  }

  async list(): Promise<Tag[]> {
    return (await queryIndex(this.db, this.tableName, "TAG", false)).map(fromTagItem);
  }

  async put(tag: Tag): Promise<void> {
    await this.db.send(new PutCommand({ TableName: this.tableName, Item: toTagItem(tag) }));
  }
}
```

- [ ] **Step 4: Chạy test để thấy thành công**

Run: `pnpm --filter @blog/api exec vitest run test/domain test/usecases test/adapters/postRepo.test.ts test/adapters/tagRepo.test.ts test/adapters/buildStatusRepo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add services/api/src/adapters/dynamo services/api/test/fixtures.ts services/api/test/adapters
git commit -m "feat(api): DynamoDB multi-slug posts and tag repository" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: EventBridge Scheduler theo ngôn ngữ

**Files:**
- Modify: `services/api/src/adapters/scheduler/publishScheduler.ts`
- Test: `services/api/test/adapters/publishScheduler.test.ts` (thay toàn bộ)

**Interfaces:**
- Consumes: `PublishScheduler` (Task 3), `ScheduledPublishEvent` (Task 4).
- Produces: `scheduleName(postId: string, lang: Lang)` → `"post-<id>-<lang>"`; `EventBridgePublishScheduler.schedule(postId, lang, publishAt)`, `.cancel(postId, lang)`; `atExpression` không đổi.

- [ ] **Step 1: Viết test thất bại**

`services/api/test/adapters/publishScheduler.test.ts` (thay toàn bộ):
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
  scheduleName,
} from "../../src/adapters/scheduler/publishScheduler";

const client = mockClient(SchedulerClient);
const scheduler = new EventBridgePublishScheduler(new SchedulerClient({ region: "ap-northeast-1" }), {
  groupName: "blog-publish",
  lambdaArn: "arn:aws:lambda:ap-northeast-1:111111111111:function:api",
  roleArn: "arn:aws:iam::111111111111:role/scheduler",
});

beforeEach(() => client.reset());

describe("naming and expressions", () => {
  it("names schedules per post and language", () => {
    expect(scheduleName("P1", "ja")).toBe("post-P1-ja");
  });

  it("formats a UTC ISO timestamp as an at() expression", () => {
    expect(atExpression("2026-10-12T08:00:00.000Z")).toBe("at(2026-10-12T08:00:00)");
  });
});

describe("schedule", () => {
  it("creates a self-deleting schedule carrying the language", async () => {
    client.on(CreateScheduleCommand).resolves({});
    await scheduler.schedule("P1", "ja", "2026-10-12T08:00:00.000Z");
    const input = client.commandCalls(CreateScheduleCommand)[0]?.args[0].input;
    expect(input).toMatchObject({
      Name: "post-P1-ja",
      GroupName: "blog-publish",
      ScheduleExpression: "at(2026-10-12T08:00:00)",
      ScheduleExpressionTimezone: "UTC",
      ActionAfterCompletion: "DELETE",
    });
    expect(JSON.parse(input?.Target?.Input ?? "{}")).toEqual({
      type: "scheduled-publish",
      postId: "P1",
      lang: "ja",
      publishAt: "2026-10-12T08:00:00.000Z",
    });
  });

  it("updates an existing schedule", async () => {
    client
      .on(CreateScheduleCommand)
      .rejects(new ConflictException({ message: "exists", Message: "exists", $metadata: {} }));
    client.on(UpdateScheduleCommand).resolves({});
    await scheduler.schedule("P1", "vi", "2026-10-13T08:00:00.000Z");
    expect(client.commandCalls(UpdateScheduleCommand)[0]?.args[0].input.Name).toBe("post-P1-vi");
  });
});

describe("cancel", () => {
  it("deletes the schedule of one language", async () => {
    client.on(DeleteScheduleCommand).resolves({});
    await scheduler.cancel("P1", "ja");
    expect(client.commandCalls(DeleteScheduleCommand)[0]?.args[0].input).toEqual({
      Name: "post-P1-ja",
      GroupName: "blog-publish",
    });
  });

  it("succeeds when the schedule is already gone", async () => {
    client
      .on(DeleteScheduleCommand)
      .rejects(new ResourceNotFoundException({ message: "gone", Message: "gone", $metadata: {} }));
    await expect(scheduler.cancel("P1", "vi")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `pnpm --filter @blog/api exec vitest run test/adapters/publishScheduler.test.ts`
Expected: FAIL — `scheduleName("P1","ja")` trả `post-P1`; sự kiện thiếu `lang`.

- [ ] **Step 3: Viết mã**

Trong `services/api/src/adapters/scheduler/publishScheduler.ts`:

Thay import type đầu file:
```ts
import type { Lang } from "@blog/shared";
import type { ScheduledPublishEvent } from "../../events";
import type { PublishScheduler } from "../../usecases/ports";
```

Thay `scheduleName`:
```ts
export const scheduleName = (postId: string, lang: Lang) => `post-${postId}-${lang}`;
```

Thay hai method của class:
```ts
  async schedule(postId: string, lang: Lang, publishAt: string): Promise<void> {
    const event: ScheduledPublishEvent = { type: "scheduled-publish", postId, lang, publishAt };
    const input: CreateScheduleCommandInput = {
      Name: scheduleName(postId, lang),
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

  async cancel(postId: string, lang: Lang): Promise<void> {
    try {
      await this.client.send(
        new DeleteScheduleCommand({
          Name: scheduleName(postId, lang),
          GroupName: this.target.groupName,
        }),
      );
    } catch (err) {
      if (err instanceof ResourceNotFoundException) return;
      throw err;
    }
  }
```

- [ ] **Step 4: Chạy test để thấy thành công**

Run: `pnpm --filter @blog/api exec vitest run test/domain test/usecases test/adapters`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add services/api/src/adapters/scheduler services/api/test/adapters/publishScheduler.test.ts
git commit -m "feat(api): per-language EventBridge schedules" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Router, handler lịch hẹn, wiring — đưa toàn bộ về xanh

**Files:**
- Modify: `services/api/src/handlers/http/router.ts` (thay toàn bộ), `services/api/src/handlers/scheduled.ts`, `services/api/src/deps.ts`
- Test: `services/api/test/handlers/router.test.ts` (thay toàn bộ), `services/api/test/handlers/scheduled.test.ts` (thay toàn bộ)

**Interfaces:**
- Consumes: mọi use case (Task 3–5), adapter (Task 6–7).
- Produces (Kế hoạch 4 dùng khi khai báo API Gateway) — route key:
  `GET /posts`, `POST /posts`, `GET /posts/{id}`, `PUT /posts/{id}`, `DELETE /posts/{id}`,
  `PUT /posts/{id}/versions/{lang}`, `DELETE /posts/{id}/versions/{lang}`,
  `POST /posts/{id}/versions/{lang}/publish`, `POST /posts/{id}/versions/{lang}/unpublish`,
  `GET /tags`, `PUT /tags/{key}`, `POST /uploads`, `GET /builds/latest`, `POST /builds`.
  Biến môi trường không đổi.

- [ ] **Step 1: Viết test thất bại**

`services/api/test/handlers/router.test.ts` (thay toàn bộ):
```ts
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import { groupsOf } from "../../src/handlers/http/auth";
import { handleHttp } from "../../src/handlers/http/router";
import { makeDeps } from "../fakes";

type Params = Record<string, string>;

const httpEvent = (
  routeKey: string,
  opts: { body?: unknown; rawBody?: string; params?: Params; groups?: unknown } = {},
) =>
  ({
    routeKey,
    pathParameters: opts.params,
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

const createVi = async (deps: ReturnType<typeof makeDeps>, title = "Học AWS") =>
  parse(await handleHttp(httpEvent("POST /posts", { body: { lang: "vi", title } }), deps, log()));

describe("posts and versions", () => {
  it("creates a post (201), adds a ja version and reads both back", async () => {
    const deps = makeDeps();
    const created = await handleHttp(httpEvent("POST /posts", { body: { lang: "vi", title: "Học AWS" } }), deps, log());
    expect(created.statusCode).toBe(201);
    const { id, version } = parse(created);
    const put = await handleHttp(
      httpEvent("PUT /posts/{id}/versions/{lang}", {
        params: { id, lang: "ja" },
        body: { title: "AWSを学ぶ", excerpt: "", content: "本文", version },
      }),
      deps,
      log(),
    );
    expect(put.statusCode).toBe(200);
    const read = parse(await handleHttp(httpEvent("GET /posts/{id}", { params: { id } }), deps, log()));
    expect(Object.keys(read.versions)).toEqual(["vi", "ja"]);
  });

  it("rejects an unknown language with 400", async () => {
    const deps = makeDeps();
    const { id } = await createVi(deps);
    const res = await handleHttp(
      httpEvent("POST /posts/{id}/versions/{lang}/publish", { params: { id, lang: "en" }, body: {} }),
      deps,
      log(),
    );
    expect(res.statusCode).toBe(400);
    expect(parse(res).error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 409 when deleting the only version and 204 when deleting the post", async () => {
    const deps = makeDeps();
    const { id } = await createVi(deps);
    const delVersion = await handleHttp(
      httpEvent("DELETE /posts/{id}/versions/{lang}", { params: { id, lang: "vi" } }),
      deps,
      log(),
    );
    expect(delVersion.statusCode).toBe(409);
    const delPost = await handleHttp(httpEvent("DELETE /posts/{id}", { params: { id } }), deps, log());
    expect(delPost.statusCode).toBe(204);
  });

  it("publishes one language and updates shared fields", async () => {
    const deps = makeDeps();
    const { id } = await createVi(deps);
    const pub = parse(
      await handleHttp(
        httpEvent("POST /posts/{id}/versions/{lang}/publish", { params: { id, lang: "vi" }, body: {} }),
        deps,
        log(),
      ),
    );
    expect(pub.versions.vi.status).toBe("published");
    const shared = await handleHttp(
      httpEvent("PUT /posts/{id}", { params: { id }, body: { tags: ["Life"], coverImage: null, version: pub.version } }),
      deps,
      log(),
    );
    expect(parse(shared).tags).toEqual(["life"]);
  });

  it("returns 400 for malformed JSON, 404 for unknown posts and routes, 409 for a duplicate slug", async () => {
    const deps = makeDeps();
    expect((await handleHttp(httpEvent("POST /posts", { rawBody: "{oops" }), deps, log())).statusCode).toBe(400);
    expect((await handleHttp(httpEvent("GET /posts/{id}", { params: { id: "x" } }), deps, log())).statusCode).toBe(404);
    expect((await handleHttp(httpEvent("GET /nope"), deps, log())).statusCode).toBe(404);
    await createVi(deps, "Same");
    const dup = await handleHttp(httpEvent("POST /posts", { body: { lang: "vi", title: "Same" } }), deps, log());
    expect(parse(dup).error.code).toBe("SLUG_TAKEN");
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

describe("tags", () => {
  it("lists tags and renames one", async () => {
    const deps = makeDeps();
    await handleHttp(httpEvent("POST /posts", { body: { lang: "vi", title: "A", tags: ["life"] } }), deps, log());
    const put = await handleHttp(
      httpEvent("PUT /tags/{key}", { params: { key: "life" }, body: { names: { ja: "暮らし" } } }),
      deps,
      log(),
    );
    expect(put.statusCode).toBe(200);
    const list = parse(await handleHttp(httpEvent("GET /tags"), deps, log()));
    expect(list).toEqual([{ key: "life", names: { ja: "暮らし" }, postCount: 1 }]);
  });
});

describe("e2e account", () => {
  it.each([
    ["POST /posts/{id}/versions/{lang}/publish", { id: "x", lang: "vi" }],
    ["POST /posts/{id}/versions/{lang}/unpublish", { id: "x", lang: "vi" }],
    ["POST /builds", {}],
  ])("is forbidden on %s", async (routeKey, params) => {
    const res = await handleHttp(httpEvent(routeKey, { params, groups: "[e2e]" }), makeDeps(), log());
    expect(res.statusCode).toBe(403);
  });

  it("may edit a draft-only post but not one with a published version", async () => {
    const deps = makeDeps();
    const draft = await createVi(deps, "Draft");
    const ok = await handleHttp(
      httpEvent("PUT /posts/{id}/versions/{lang}", {
        params: { id: draft.id, lang: "vi" },
        body: { title: "Draft 2", excerpt: "", content: "", version: draft.version },
        groups: "[e2e]",
      }),
      deps,
      log(),
    );
    expect(ok.statusCode).toBe(200);

    const live = await createVi(deps, "Live");
    const pub = parse(
      await handleHttp(
        httpEvent("POST /posts/{id}/versions/{lang}/publish", { params: { id: live.id, lang: "vi" }, body: {} }),
        deps,
        log(),
      ),
    );
    for (const [routeKey, params, body] of [
      ["PUT /posts/{id}", { id: live.id }, { tags: [], coverImage: null, version: pub.version }],
      ["PUT /posts/{id}/versions/{lang}", { id: live.id, lang: "ja" }, { title: "x", excerpt: "", content: "", version: pub.version }],
      ["DELETE /posts/{id}", { id: live.id }, undefined],
    ] as const) {
      const res = await handleHttp(httpEvent(routeKey, { params, body, groups: "[e2e]" }), deps, log());
      expect(res.statusCode).toBe(403);
    }
  });

  it("puts uploads under media/e2e/", async () => {
    const res = await handleHttp(
      httpEvent("POST /uploads", { body: { contentType: "image/png" }, groups: "[e2e]" }),
      makeDeps(),
      log(),
    );
    expect(parse(res).key).toMatch(/^media\/e2e\//);
  });
});

describe("groupsOf", () => {
  it.each([
    [undefined, []],
    ["[e2e]", ["e2e"]],
    ["[admin e2e]", ["admin", "e2e"]],
    [["admin", "e2e"], ["admin", "e2e"]],
  ])("parses %j", (groups, expected) => {
    expect(groupsOf(httpEvent("GET /posts", { groups }))).toEqual(expected);
  });
});
```

`services/api/test/handlers/scheduled.test.ts` (thay toàn bộ):
```ts
import { describe, expect, it } from "vitest";
import { handleScheduled } from "../../src/handlers/scheduled";
import { createPost, getPost } from "../../src/usecases/posts";
import { publishVersion } from "../../src/usecases/publishing";
import { makeDeps } from "../fakes";

describe("handleScheduled", () => {
  it("publishes the language named in the event", async () => {
    const deps = makeDeps();
    const post = await createPost(deps, {
      lang: "vi",
      title: "T",
      excerpt: "",
      content: "",
      tags: [],
      coverImage: null,
    });
    await publishVersion(deps, post.id, "vi", { publishAt: "2026-10-12T08:00:00Z" });
    await handleScheduled(
      { type: "scheduled-publish", postId: post.id, lang: "vi", publishAt: "2026-10-12T08:00:00.000Z" },
      deps,
    );
    expect((await getPost(deps, post.id)).versions.vi?.status).toBe("published");
  });

  it("rejects an event without a language", async () => {
    await expect(
      handleScheduled(
        { type: "scheduled-publish", postId: "P1", publishAt: "2026-10-12T08:00:00.000Z" },
        makeDeps(),
      ),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Chạy test để thấy thất bại**

Run: `pnpm --filter @blog/api exec vitest run test/handlers`
Expected: FAIL — router cũ không có route `versions`/`tags`; `handleScheduled` chưa truyền `lang`.

- [ ] **Step 3: Viết mã**

`services/api/src/handlers/http/router.ts` (thay toàn bộ):
```ts
import {
  createPostInputSchema,
  createUploadInputSchema,
  type Lang,
  langSchema,
  publishInputSchema,
  putTagInputSchema,
  updatePostInputSchema,
  upsertVersionInputSchema,
} from "@blog/shared";
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { ZodError } from "zod";
import { DomainError } from "../../domain/errors";
import { getLatestBuild, triggerBuild } from "../../usecases/builds";
import type { Deps, Log } from "../../usecases/ports";
import { createPost, deletePost, getPost, listPosts, updatePost } from "../../usecases/posts";
import { publishVersion, unpublishVersion } from "../../usecases/publishing";
import { listTags, putTag } from "../../usecases/tags";
import { createUpload } from "../../usecases/uploads";
import { deleteVersion, upsertVersion } from "../../usecases/versions";
import { isE2EUser } from "./auth";
import { errorResponse, type HttpResult, json, noContent } from "./response";

interface RouteContext {
  deps: Deps;
  /** Required path parameter. */
  param: (name: string) => string;
  /** The `{lang}` path parameter, validated. */
  lang: () => Lang;
  body: unknown;
  caller: { e2e: boolean };
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
  "GET /posts/{id}": { run: async ({ deps, param }) => json(200, await getPost(deps, param("id"))) },
  "PUT /posts/{id}": {
    run: async ({ deps, param, body, caller }) =>
      json(200, await updatePost(deps, param("id"), updatePostInputSchema.parse(body), caller)),
  },
  "DELETE /posts/{id}": {
    run: async ({ deps, param, caller }) => {
      await deletePost(deps, param("id"), caller);
      return noContent();
    },
  },
  "PUT /posts/{id}/versions/{lang}": {
    run: async ({ deps, param, lang, body, caller }) =>
      json(200, await upsertVersion(deps, param("id"), lang(), upsertVersionInputSchema.parse(body), caller)),
  },
  "DELETE /posts/{id}/versions/{lang}": {
    run: async ({ deps, param, lang, caller }) => {
      await deleteVersion(deps, param("id"), lang(), caller);
      return noContent();
    },
  },
  "POST /posts/{id}/versions/{lang}/publish": {
    forbiddenForE2E: true,
    run: async ({ deps, param, lang, body }) =>
      json(200, await publishVersion(deps, param("id"), lang(), publishInputSchema.parse(body ?? {}))),
  },
  "POST /posts/{id}/versions/{lang}/unpublish": {
    forbiddenForE2E: true,
    run: async ({ deps, param, lang }) => json(200, await unpublishVersion(deps, param("id"), lang())),
  },
  "GET /tags": { run: async ({ deps }) => json(200, await listTags(deps)) },
  "PUT /tags/{key}": {
    run: async ({ deps, param, body, caller }) =>
      json(200, await putTag(deps, param("key"), putTagInputSchema.parse(body), caller)),
  },
  "POST /uploads": {
    run: async ({ deps, body, caller }) =>
      json(200, await createUpload(deps, createUploadInputSchema.parse(body), caller)),
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

  const caller = { e2e: isE2EUser(event) };
  if (route.forbiddenForE2E && caller.e2e) {
    return errorResponse("FORBIDDEN", "the e2e account cannot change what is published");
  }

  try {
    const param = (name: string) => {
      const value = event.pathParameters?.[name];
      if (!value) throw new DomainError("VALIDATION_ERROR", `missing path parameter: ${name}`);
      return value;
    };
    const lang = () => langSchema.parse(param("lang"));
    return await route.run({ deps, param, lang, body: parseBody(event), caller });
  } catch (err) {
    return toErrorResponse(err, log, event.requestContext.requestId);
  }
}
```

`services/api/src/handlers/scheduled.ts` (thay toàn bộ):
```ts
import { scheduledPublishEventSchema } from "../events";
import type { Deps } from "../usecases/ports";
import { runScheduledPublish } from "../usecases/publishing";

export async function handleScheduled(event: unknown, deps: Deps): Promise<void> {
  const { postId, lang, publishAt } = scheduledPublishEventSchema.parse(event);
  await runScheduledPublish(deps, { postId, lang, publishAt });
}
```

Trong `services/api/src/deps.ts`:

Thêm import:
```ts
import { DynamoTagRepository } from "./adapters/dynamo/tagRepo";
```

Thay dòng tạo `db`:
```ts
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
```

Thêm vào object trả về, ngay sau `posts: …`:
```ts
    tags: new DynamoTagRepository(db, config.TABLE_NAME),
```

- [ ] **Step 4: Chạy toàn bộ kiểm tra**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test`
Expected: lint sạch (chỉ còn 1 info `recommended` đã ghi nhận ở Kế hoạch 1), typecheck sạch, mọi test PASS.

- [ ] **Step 5: Xác nhận domain không phụ thuộc AWS**

Run: `grep -rn "@aws-sdk\|adapters/" services/api/src/domain || echo "OK: domain is AWS-free"`
Expected: `OK: domain is AWS-free`.

- [ ] **Step 6: Commit**

```bash
git add services/api
git commit -m "feat(api): bilingual routes, tag routes and per-language scheduled handler" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Hoàn tất Kế hoạch 1b

- `pnpm lint && pnpm typecheck && pnpm test` xanh từ thư mục gốc.
- Kế hoạch 3 (Lambda Build) đọc bài qua `queryIndex(…, "POST", …)` và tag qua `queryIndex(…, "TAG", …)`; Kế hoạch 4 khai báo GSI `byUpdated` (`GSI1PK`/`GSI1SK` kiểu chuỗi), route key ở Task 8, và lịch hẹn nhóm `blog-publish` với tên `post-<id>-<lang>`.
