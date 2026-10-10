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
    expect(planSync(["index.html"], ["media/2026/a.webp", "old.html"]).deletes).toEqual([
      "old.html",
    ]);
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
    const lastAsset = order.findLastIndex(
      (k) => !String(k).endsWith(".html") && !String(k).startsWith("DELETE"),
    );
    expect(lastAsset).toBeLessThan(firstPage);
    expect(order.at(-1)).toBe("DELETE gone.html");
    expect(plan.deletes).toEqual(["gone.html"]);

    const css = s3mock
      .commandCalls(PutObjectCommand)
      .find((c) => c.args[0].input.Key === "_astro/app.abc123.css");
    expect(css?.args[0].input).toMatchObject({
      Bucket: "site-bucket",
      ContentType: "text/css; charset=utf-8",
      CacheControl: IMMUTABLE,
    });
  });
});
