import { describe, expect, it } from "vitest";
import { readingMinutes } from "../src/index";

describe("readingMinutes", () => {
  it("counts Vietnamese words at 200 per minute", () => {
    expect(readingMinutes(Array.from({ length: 400 }, () => "chữ").join(" "), "vi")).toBe(2);
  });

  it("counts Japanese characters at 500 per minute", () => {
    expect(readingMinutes("あ".repeat(1000), "ja")).toBe(2);
  });

  it("never returns less than one minute", () => {
    expect(readingMinutes("ngắn", "vi")).toBe(1);
  });

  it("ignores fenced code blocks", () => {
    const code = `\`\`\`ts\n${"x ".repeat(2000)}\n\`\`\``;
    expect(readingMinutes(`ngắn\n\n${code}`, "vi")).toBe(1);
  });
});
