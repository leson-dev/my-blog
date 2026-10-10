import { execFile } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const MAX_OUTPUT = 64 * 1024 * 1024;

export interface SiteBuildOptions {
  /** apps/site; may be read-only (it is in the Lambda image). */
  siteDir: string;
  /** Holds posts.json and tags.json exported from DynamoDB. */
  dataDir: string;
  /** Writable output directory (Astro outDir, Pagefind writes into it). */
  outDir: string;
  /** Writable cache directory for Astro and Vite. */
  cacheDir: string;
}

/**
 * Runs `astro build` and Pagefind. The site directory is never written to: output and caches
 * go to the given writable directories (astro.config.mjs reads SITE_OUT_DIR / SITE_CACHE_DIR).
 * Astro's generated `.astro/` folder is the one exception — the image makes it a symlink to /tmp.
 */
export async function runSiteBuild(opts: SiteBuildOptions): Promise<string> {
  for (const file of ["posts.json", "tags.json"]) {
    const path = join(opts.dataDir, file);
    if (!existsSync(path)) throw new Error(`site data missing: ${path}`);
  }
  rmSync(opts.outDir, { recursive: true, force: true });

  const options = {
    cwd: opts.siteDir,
    maxBuffer: MAX_OUTPUT,
    env: {
      ...process.env,
      BLOG_DATA_DIR: opts.dataDir,
      SITE_OUT_DIR: opts.outDir,
      SITE_CACHE_DIR: opts.cacheDir,
      ASTRO_TELEMETRY_DISABLED: "1",
      HOME: tmpdir(),
    },
  };
  await run(
    process.execPath,
    [join(opts.siteDir, "node_modules/astro/bin/astro.mjs"), "build"],
    options,
  );
  await run(
    process.execPath,
    [join(opts.siteDir, "node_modules/pagefind/lib/runner/bin.cjs"), "--site", opts.outDir],
    options,
  );
  return opts.outDir;
}
