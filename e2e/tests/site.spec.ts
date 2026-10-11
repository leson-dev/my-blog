import { expect, type Page, test } from "@playwright/test";

const postLinks = (page: Page) => page.locator(".archive-row a");

/** Tests that need a post are skipped (not failed) while the blog is still empty. */
async function skipIfNoPosts(page: Page) {
  test.skip((await postLinks(page).count()) === 0, "the blog has no posts yet");
}

test("the home page is Vietnamese by default", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "vi");
  await expect(page.locator(".site-header .logo")).toContainText("~/oki-dev");
});

test("choosing ja is remembered the next time / is opened", async ({ page }) => {
  await page.goto("/");
  await page.locator('.lang-switch [data-lang-switch="ja"]').click();
  await expect(page).toHaveURL(/\/ja\/$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await page.goto("/");
  await expect(page).toHaveURL(/\/ja\/$/);
});

test("dates follow the reader's time zone", async ({ page }) => {
  await page.goto("/vi/");
  await skipIfNoPosts(page);
  const time = page.locator("time[data-local-date]").first();
  const iso = (await time.getAttribute("datetime")) ?? "";
  const expected = await page.evaluate(
    (value) =>
      new Intl.DateTimeFormat("sv-SE", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(value)),
    iso,
  );
  await expect(time).toHaveText(expected);
});

test("opening a post does not reload the page", async ({ page }) => {
  await page.goto("/vi/");
  await skipIfNoPosts(page);
  await page.evaluate(() => {
    (window as unknown as { e2eMarker?: number }).e2eMarker = 1;
  });
  await postLinks(page).first().click();
  await expect(page.locator("article .post-title")).toBeVisible();
  await expect(page.locator("article .prose")).toBeAttached();
  expect(await page.evaluate(() => (window as unknown as { e2eMarker?: number }).e2eMarker)).toBe(
    1,
  );
});

test("the search page loads Pagefind", async ({ page }) => {
  await page.goto("/vi/search/");
  await expect(page.locator("#search input")).toBeVisible();
});

test("an unknown path shows the 404 page", async ({ page }) => {
  const res = await page.goto(`/khong-ton-tai-${Date.now()}/`);
  expect(res?.status()).toBe(404);
  await expect(page.locator("body")).toContainText("404");
});
