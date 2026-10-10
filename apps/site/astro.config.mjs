import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://blog.oki-dev.xyz",
  output: "static",
  trailingSlash: "always",
  build: { format: "directory" },
  compressHTML: true,
  prefetch: { prefetchAll: true, defaultStrategy: "hover" },
});
