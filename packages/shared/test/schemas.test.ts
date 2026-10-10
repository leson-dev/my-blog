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
    for (const contentType of [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/avif",
    ]) {
      expect(createUploadInputSchema.safeParse({ contentType }).success).toBe(true);
    }
  });

  it("rejects SVG (can carry scripts)", () => {
    expect(createUploadInputSchema.safeParse({ contentType: "image/svg+xml" }).success).toBe(false);
  });
});
