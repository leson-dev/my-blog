import { beforeAll, describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/index";

describe("renderMarkdown", () => {
  // The first call builds the shared Shiki highlighter (grammars + regex engine), which can take
  // several seconds on a cold CI runner; do it once here so each test only times its own work.
  beforeAll(() => renderMarkdown("```ts\nconst warm = true;\n```"), 60_000);

  it("renders headings with ids and keeps Vietnamese and Japanese text", async () => {
    const html = await renderMarkdown("## Hàm đầu tiên\n\n紅葉の季節です。");
    expect(html).toMatch(/<h2 id="[^"]+">Hàm đầu tiên<\/h2>/);
    expect(html).toContain("紅葉の季節です。");
  });

  it("supports GitHub-flavoured tables", async () => {
    const html = await renderMarkdown("| a | b |\n| - | - |\n| 1 | 2 |");
    expect(html).toContain("<table>");
  });

  it("drops raw HTML such as script tags and event handlers", async () => {
    const html = await renderMarkdown(
      '<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\nok',
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).toContain("ok");
  });

  it("removes javascript: links", async () => {
    const html = await renderMarkdown("[click](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });

  it("highlights code with the dual GitHub themes", async () => {
    const html = await renderMarkdown("```ts\nconst a = 1;\n```");
    expect(html).toContain('class="shiki');
    expect(html).toContain("--shiki-dark");
  });

  it("does not fail on an unknown code language", async () => {
    const html = await renderMarkdown("```nosuchlang\nplain text\n```");
    expect(html).toContain("plain text");
  });

  it("links footnote references to their notes", async () => {
    const html = await renderMarkdown("Text[^1]\n\n[^1]: note");
    const href = html.match(/href="#([^"]+)"/)?.[1];
    expect(href).toBeDefined();
    expect(html).toContain(`id="${href}"`);
  });

  it("lazy-loads images", async () => {
    const html = await renderMarkdown("![alt](/media/2026/a.webp)");
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
  });
});
