import { expect, type Page, test } from "@playwright/test";
import { POST_ID, useFakeBackend } from "./fakeBackend";

/** C1 tokens (packages/ui-tokens): --fg-strong and --bg in each colour scheme. */
const SCHEMES = [
  { scheme: "dark", caret: "rgb(240, 246, 252)", background: "rgb(13, 17, 23)" },
  { scheme: "light", caret: "rgb(31, 35, 40)", background: "rgb(255, 255, 255)" },
] as const;

async function openEditor(page: Page, scheme: "dark" | "light") {
  await page.emulateMedia({ colorScheme: scheme });
  await useFakeBackend(page);
  await page.goto(`/posts/${POST_ID}`);
  await page.locator(".cm-content").click();
}

// The editor uses the browser's native caret (no drawSelection extension), so its colour is
// `caret-color` on .cm-content — CodeMirror's built-in light theme sets it to black.
for (const { scheme, caret, background } of SCHEMES) {
  test(`the editor caret stands out in ${scheme} mode`, async ({ page }) => {
    await openEditor(page, scheme);
    const content = page.locator(".cm-content");
    expect(await content.evaluate((el) => getComputedStyle(el).caretColor)).toBe(caret);
    expect(
      await page.locator(".cm-editor").evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe(background);
  });
}
