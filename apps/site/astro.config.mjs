import { defineConfig } from "astro/config";

// The Build Lambda runs this site from a read-only directory: every write goes to paths
// passed in through the environment (see services/build/src/siteBuild.ts).
const cacheDir = process.env.SITE_CACHE_DIR ?? "./.cache";

export default defineConfig({
  site: "https://blog.oki-dev.xyz",
  output: "static",
  trailingSlash: "always",
  build: { format: "directory" },
  compressHTML: true,
  prefetch: { prefetchAll: true, defaultStrategy: "hover" },
  outDir: process.env.SITE_OUT_DIR ?? "./dist",
  cacheDir: `${cacheDir}/astro`,
  vite: { cacheDir: `${cacheDir}/vite` },
});
