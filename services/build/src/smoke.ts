import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config";
import { prepareDotAstro, runSiteBuild } from "./siteBuild";

// Image smoke test: build the fixture site exactly like the Lambda does (read-only site dir,
// writes only under /tmp). AWS values are placeholders; nothing talks to AWS here.
const config = loadConfig({
  TABLE_NAME: "-",
  SITE_BUCKET: "-",
  DISTRIBUTION_ID: "-",
  ...process.env,
});
const dataDir = "/tmp/smoke-data";

prepareDotAstro(config.DOT_ASTRO_DIR, config.SITE_DIR);
mkdirSync(dataDir, { recursive: true });
cpSync(join(config.SITE_DIR, "fixtures"), dataDir, { recursive: true });
const outDir = await runSiteBuild({
  siteDir: config.SITE_DIR,
  dataDir,
  outDir: config.OUT_DIR,
  cacheDir: config.CACHE_DIR,
  deadline: Date.now() + 240_000,
});
const pages = readdirSync(outDir, { recursive: true }).filter((p) => String(p).endsWith(".html"));
console.log(`smoke ok: ${pages.length} pages`);
