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
    expect(createPostInputSchema.safeParse({ lang: "vi", title: "t", content }).success).toBe(
      false,
    );
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
    expect(
      updatePostInputSchema.safeParse({ tags: [], coverImage: null, version: 2 }).success,
    ).toBe(true);
    expect(
      updatePostInputSchema.safeParse({ tags: [], coverImage: null, version: 0 }).success,
    ).toBe(false);
  });
});

describe("upsertVersionInputSchema", () => {
  it("makes the slug optional", () => {
    const r = upsertVersionInputSchema.safeParse({
      title: "t",
      excerpt: "",
      content: "",
      version: 1,
    });
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
    expect(publishInputSchema.safeParse({ publishAt: "2026-10-12T08:00:00.123Z" }).success).toBe(
      true,
    );
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
    expect(putTagInputSchema.parse({ names: { ja: " 暮らし " } })).toEqual({
      names: { ja: "暮らし" },
    });
  });

  it("rejects an empty name", () => {
    expect(putTagInputSchema.safeParse({ names: { vi: "   " } }).success).toBe(false);
  });
});
