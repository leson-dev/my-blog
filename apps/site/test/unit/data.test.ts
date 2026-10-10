import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { dataDir, loadSiteData } from "../../src/lib/data";

const fixtures = resolve(__dirname, "../../fixtures");

describe("dataDir", () => {
  it("prefers BLOG_DATA_DIR and falls back to ./fixtures", () => {
    expect(dataDir({ BLOG_DATA_DIR: "/tmp/data" })).toBe("/tmp/data");
    expect(dataDir({})).toBe(resolve(process.cwd(), "fixtures"));
  });
});

describe("loadSiteData", () => {
  it("loads and validates the fixtures", () => {
    const data = loadSiteData(fixtures);
    expect(data.posts.map((p) => p.id)).toEqual(["P1", "P2", "P3", "P4", "P5"]);
    expect(data.tags).toEqual([{ key: "life", names: { vi: "đời sống", ja: "暮らし" } }]);
  });

  it("fails with the file name when posts.json is malformed", () => {
    const dir = mkdtempSync(join(tmpdir(), "site-data-"));
    writeFileSync(join(dir, "posts.json"), JSON.stringify([{ id: "X" }]));
    writeFileSync(join(dir, "tags.json"), "[]");
    expect(() => loadSiteData(dir)).toThrow(/posts\.json/);
  });

  it("fails with the file name when tags.json is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "site-data-"));
    writeFileSync(join(dir, "posts.json"), "[]");
    expect(() => loadSiteData(dir)).toThrow(/tags\.json/);
  });
});
