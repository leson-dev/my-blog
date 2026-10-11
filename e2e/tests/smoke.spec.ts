import { expect, test } from "@playwright/test";

const ADMIN_URL = process.env.ADMIN_URL ?? "https://admin.oki-dev.xyz";
const API_URL = process.env.API_URL ?? "https://api.oki-dev.xyz";

test.describe("blog", () => {
  for (const path of [
    "/",
    "/vi/",
    "/ja/",
    "/vi/tags/",
    "/ja/tags/",
    "/vi/search/",
    "/pagefind/pagefind.js",
  ]) {
    test(`${path} → 200`, async ({ request }) => {
      expect((await request.get(path)).status()).toBe(200);
    });
  }

  test("an unknown path gets the 404 page", async ({ request }) => {
    const res = await request.get(`/khong-ton-tai-${Date.now()}/`);
    expect(res.status()).toBe(404);
    expect(await res.text()).toContain("404");
  });

  test("sends the security headers", async ({ request }) => {
    const headers = (await request.get("/")).headers();
    expect(headers["strict-transport-security"]).toContain("max-age=");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBeTruthy();
  });
});

test("the API refuses calls without a token", async ({ request }) => {
  expect((await request.get(`${API_URL}/posts`)).status()).toBe(401);
});

test.describe("admin", () => {
  test("serves the app with its CSP, never cached", async ({ request }) => {
    const res = await request.get(`${ADMIN_URL}/`);
    expect(res.status()).toBe(200);
    const headers = res.headers();
    expect(headers["content-security-policy"]).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["cache-control"]).toBe("no-cache");
  });

  test("config.json points at the API and Cognito", async ({ request }) => {
    const config = await (await request.get(`${ADMIN_URL}/config.json`)).json();
    expect(config.apiUrl).toBe(API_URL);
    expect(config.redirectUri).toBe(`${ADMIN_URL}/`);
    expect(config.cognitoDomain).toMatch(
      /^https:\/\/[a-z0-9-]+\.auth\.ap-northeast-1\.amazoncognito\.com$/,
    );
  });
});
