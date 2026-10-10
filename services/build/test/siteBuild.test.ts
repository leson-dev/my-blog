import { cpSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runSiteBuild } from "../src/siteBuild";

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
      }),
    ).rejects.toThrow(/site data missing: .*posts\.json/);
  });

  it("builds the site and its search index into the given output directory", async () => {
    const dataDir = temp("data-");
    cpSync(join(siteDir, "fixtures"), dataDir, { recursive: true });
    const outDir = join(temp("out-"), "dist");

    const result = await runSiteBuild({ siteDir, dataDir, outDir, cacheDir: temp("cache-") });

    expect(result).toBe(outDir);
    expect(readFileSync(join(outDir, "index.html"), "utf8")).toContain(
      "Học AWS Lambda từ con số 0",
    );
    expect(existsSync(join(outDir, "pagefind/pagefind.js"))).toBe(true);
  });
});
