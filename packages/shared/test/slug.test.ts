import { describe, expect, it } from "vitest";
import { isValidSlug, slugify } from "../src/index";

describe("slugify (shared with the admin editor)", () => {
  it.each([
    ["Học AWS", "hoc-aws"],
    ["Đà Nẵng mùa thu", "da-nang-mua-thu"],
    ["  Serverless -- 101!  ", "serverless-101"],
    ["紅葉の季節", ""],
    ["AWS と 紅葉", "aws"],
  ])("%s → %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("cuts long titles at a word boundary within 100 characters", () => {
    const slug = slugify(`${"chu ".repeat(40)}cuoi`);
    expect(slug.length).toBeLessThanOrEqual(100);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("validates slugs", () => {
    expect(isValidSlug("hoc-aws")).toBe(true);
    expect(isValidSlug("Hoc AWS")).toBe(false);
    expect(isValidSlug("")).toBe(false);
  });
});
