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
