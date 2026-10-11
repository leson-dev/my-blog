import { defineConfig, devices } from "@playwright/test";

/** Read-only checks against production (spec 5.4). Override the URLs to point elsewhere. */
export default defineConfig({
  testDir: "tests",
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.BLOG_URL ?? "https://blog.oki-dev.xyz",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "smoke", testMatch: /smoke\.spec\.ts/ },
    {
      name: "site-tokyo",
      testMatch: /site\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], timezoneId: "Asia/Tokyo" },
    },
    {
      name: "site-hcm",
      testMatch: /site\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], timezoneId: "Asia/Ho_Chi_Minh" },
    },
  ],
});
