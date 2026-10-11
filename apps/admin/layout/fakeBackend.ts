import type { Page } from "@playwright/test";

const now = new Date().toISOString();

const version = (lang: "vi" | "ja", status: "draft" | "published", title: string) => ({
  slug: `slug-${lang}`,
  title,
  excerpt: "Tóm tắt ngắn",
  content: "## Mở đầu\n\nNội dung **bài viết**.\n\n```ts\nconst x = 1;\n```",
  status,
  publishAt: null,
  publishedAt: status === "published" ? now : null,
  updatedAt: now,
});

export const POST_ID = "01JLAYOUT";

const post = {
  id: POST_ID,
  tags: ["aws", "doi-song"],
  coverImage: null,
  createdAt: now,
  updatedAt: now,
  version: 3,
  versions: {
    vi: version("vi", "published", "Học AWS Lambda từ con số không"),
    ja: version("ja", "draft", "AWS Lambdaを学ぶ"),
  },
};

const tags = [
  { key: "aws", names: { vi: "AWS", ja: "AWS" }, postCount: 3 },
  { key: "doi-song", names: { vi: "Đời sống" }, postCount: 1 },
];

/** Serves config.json, a signed-in session and a read-only API, so pages render without AWS. */
export async function useFakeBackend(page: Page) {
  await page.route("**/config.json", (route) =>
    route.fulfill({
      json: {
        region: "ap-northeast-1",
        apiUrl: "https://api.test",
        userPoolId: "pool",
        userPoolClientId: "client",
        cognitoDomain: "https://auth.test",
        redirectUri: "http://localhost:4173/",
      },
    }),
  );
  await page.route("https://api.test/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/posts") return route.fulfill({ json: [post] });
    if (path.startsWith("/posts/")) return route.fulfill({ json: post });
    if (path === "/tags") return route.fulfill({ json: tags });
    if (path === "/builds/latest") {
      return route.fulfill({ json: { status: "success", updatedAt: now, error: null } });
    }
    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: path } } });
  });
  await page.addInitScript(() => {
    const tokens = {
      accessToken: "a",
      idToken: "i",
      refreshToken: "r",
      expiresAt: Date.now() + 3_600_000,
    };
    localStorage.setItem("oki-admin:tokens", JSON.stringify(tokens));
  });
}
