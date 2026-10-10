import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareDotAstro, runSiteBuild } from "../src/siteBuild";

const siteDir = resolve(__dirname, "../../../apps/site");
const temp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));

describe("runSiteBuild", () => {
  it("refuses to build without exported site data", async () => {
    await expect(
      runSiteBuild({
        siteDir,
        dataDir: temp("no-data-"),
        outDir: temp("out-"),
        cacheDir: temp("cache-"),
        deadline: Date.now() + 60_000,
      }),
    ).rejects.toThrow(/site data missing: .*posts\.json/);
  });

  it("builds the site and its search index into the given output directory", async () => {
    const dataDir = temp("data-");
    cpSync(join(siteDir, "fixtures"), dataDir, { recursive: true });
    const outDir = join(temp("out-"), "dist");

    const result = await runSiteBuild({
      siteDir,
      dataDir,
      outDir,
      cacheDir: temp("cache-"),
      deadline: Date.now() + 120_000,
    });

    expect(result).toBe(outDir);
    expect(readFileSync(join(outDir, "index.html"), "utf8")).toContain(
      "Học AWS Lambda từ con số 0",
    );
    expect(existsSync(join(outDir, "pagefind/pagefind.js"))).toBe(true);
  });
});

describe("runSiteBuild deadline", () => {
  it("kills a build that runs past the deadline and says so", async () => {
    const dataDir = temp("data-");
    cpSync(join(siteDir, "fixtures"), dataDir, { recursive: true });
    await expect(
      runSiteBuild({
        siteDir,
        dataDir,
        outDir: join(temp("out-"), "dist"),
        cacheDir: temp("cache-"),
        deadline: Date.now() + 50,
      }),
    ).rejects.toThrow(/timed out/);
  });
});

describe("prepareDotAstro", () => {
  it("creates the .astro target with a node_modules link so prerender chunks resolve packages", () => {
    const dotAstro = join(temp("dot-"), "astro-dot");
    prepareDotAstro(dotAstro, siteDir);
    prepareDotAstro(dotAstro, siteDir); // idempotent

    const link = join(dotAstro, "node_modules");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(join(siteDir, "node_modules"));
  });
});
