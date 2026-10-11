import { defineConfig, devices } from "@playwright/test";

/**
 * Layout checks of the built admin (`pnpm --filter @blog/admin build` first) against a fake API:
 * no AWS, no login. Unit tests live in test/ (Vitest); these run in a real browser.
 */
export default defineConfig({
  testDir: "layout",
  testMatch: /\.layout\.ts$/,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:4173" },
  webServer: {
    command: "pnpm exec vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
  },
});
