import { readFile } from "node:fs/promises";
import { join } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** Dev server only: serve /config.json from dev-config.json (see scripts/dev-config.mjs). */
const devConfig = (): Plugin => ({
  name: "admin-dev-config",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use("/config.json", async (_req, res) => {
      try {
        const body = await readFile(join(import.meta.dirname, "dev-config.json"), "utf8");
        res.setHeader("content-type", "application/json");
        res.end(body);
      } catch {
        res.statusCode = 404;
        res.end("run `pnpm --filter @blog/admin dev:config` first");
      }
    });
  },
});

export default defineConfig({
  plugins: [react(), devConfig()],
  server: { port: 5173, strictPort: true },
  build: { target: "es2023", sourcemap: true },
});
