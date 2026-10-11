import { expect, type Locator, type Page, test } from "@playwright/test";
import { POST_ID, useFakeBackend } from "./fakeBackend";

const PAGES = [
  { name: "post list", path: "/", ready: "+ Bài mới" },
  { name: "editor", path: `/posts/${POST_ID}`, ready: "Tiêu đề" },
  { name: "tags", path: "/tags", ready: "Tên vi của aws" },
] as const;

const WIDTHS = [375, 768, 1280];

async function open(page: Page, width: number, path: string) {
  await page.setViewportSize({ width, height: 800 });
  await useFakeBackend(page);
  await page.goto(path);
}

/** Visible and fully on screen — polled, so a sliding drawer can finish its transition. */
async function expectInsideViewport(locator: Locator, width: number) {
  await expect(locator).toBeVisible();
  await expect
    .poll(async () => {
      const box = await locator.boundingBox();
      return box !== null && box.x >= 0 && box.x + box.width <= width + 1;
    })
    .toBe(true);
}

for (const width of WIDTHS) {
  for (const { name, path, ready } of PAGES) {
    test(`${name} at ${width}px never scrolls sideways`, async ({ page }) => {
      await open(page, width, path);
      await expect(
        page.getByRole("button", { name: ready }).or(page.getByLabel(ready)).first(),
      ).toBeVisible();
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(width);
    });
  }
}

test("on a phone the top bar keeps every control on screen", async ({ page }) => {
  await open(page, 375, `/posts/${POST_ID}`);
  for (const control of [
    page.getByRole("button", { name: "Cập nhật bản vi" }),
    page.getByRole("button", { name: "Thông tin bài" }),
    page.getByRole("button", { name: "Build lại" }),
    page.getByRole("link", { name: "tags" }),
    page.getByRole("button", { name: "đăng xuất" }),
  ]) {
    await expectInsideViewport(control, 375);
  }
});

test("on a phone the info column opens over the editor and closes again", async ({ page }) => {
  await open(page, 375, `/posts/${POST_ID}`);
  const info = page.getByRole("complementary", { name: "Thông tin" });
  await expect(info).toBeHidden();
  await page.getByRole("button", { name: "Thông tin bài" }).click();
  await expectInsideViewport(page.getByLabel("Slug"), 375);
  await page.getByRole("button", { name: "Đóng" }).click();
  await expect(info).toBeHidden();
});

test("on a wide screen the info column is always shown", async ({ page }) => {
  await open(page, 1280, `/posts/${POST_ID}`);
  await expect(page.getByLabel("Slug")).toBeVisible();
  await expect(page.getByRole("button", { name: "Thông tin bài" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Đóng" })).toBeHidden();
});

test("on a phone each tag's names can be edited on screen", async ({ page }) => {
  await open(page, 375, "/tags");
  await expectInsideViewport(page.getByLabel("Tên ja của doi-song"), 375);
});
