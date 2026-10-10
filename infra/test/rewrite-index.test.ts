import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type Request = { uri: string };
const code = readFileSync(join(import.meta.dirname, "../functions/rewrite-index.js"), "utf8");
const handler = new Function(`${code}; return handler;`)() as (event: {
  request: Request;
}) => Request;
const rewrite = (uri: string) => handler({ request: { uri } }).uri;

describe("rewrite-index CloudFront Function", () => {
  it.each([
    ["/", "/index.html"],
    ["/vi/", "/vi/index.html"],
    ["/ja/posts/tokyo-autumn/", "/ja/posts/tokyo-autumn/index.html"],
    ["/vi/tags/life", "/vi/tags/life/index.html"],
    ["/_astro/app.abc123.css", "/_astro/app.abc123.css"],
    ["/404.html", "/404.html"],
    ["/pagefind/pagefind.js", "/pagefind/pagefind.js"],
  ])("%s -> %s", (uri, expected) => {
    expect(rewrite(uri)).toBe(expected);
  });
});
