import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const siteRoot = resolve(__dirname, "../..");
const dist = join(siteRoot, "dist");
const read = (path: string) => readFileSync(join(dist, path), "utf8");
const exists = (path: string) => existsSync(join(dist, path));

beforeAll(() => {
  execFileSync("pnpm", ["run", "build"], {
    cwd: siteRoot,
    stdio: "pipe",
    env: { ...process.env, BLOG_DATA_DIR: join(siteRoot, "fixtures") },
  });
});

describe("home pages", () => {
  it("serves the Vietnamese home at / with a guarded language redirect", () => {
    const html = read("index.html");
    expect(html).toContain('<html lang="vi"');
    expect(html).toContain("Học AWS Lambda từ con số 0");
    expect(html).toMatch(/try\s*{[^}]*localStorage/);
    expect(html).toContain('location.replace("/ja/")');
  });

  it("lists each published post once on /vi/, grouped by year, without drafts", () => {
    const html = read("vi/index.html");
    expect(html).not.toContain('location.replace("/ja/")');
    expect(html).toContain(">2026<");
    expect(html).toContain(">2025<");
    expect(html).toContain("Mùa thu đầu tiên ở Tokyo");
    expect(html).not.toContain("東京で迎える初めての秋");
    expect(html).toContain("日本語のメモ");
    expect(html).toMatch(/日本語のメモ[\s\S]{0,200}data-lang-label[^>]*>ja</);
    expect(html).not.toContain("Bản nháp bí mật");
    expect(html).not.toContain("DynamoDB シングルテーブル設計");
  });

  it("uses Japanese titles and labels Vietnamese-only posts on /ja/", () => {
    const html = read("ja/index.html");
    expect(html).toContain('<html lang="ja"');
    expect(html).toContain("東京で迎える初めての秋");
    expect(html).toMatch(/Học AWS Lambda từ con số 0[\s\S]{0,200}data-lang-label[^>]*>vi</);
  });

  it("renders local-date placeholders and the language switch", () => {
    const html = read("vi/index.html");
    expect(html).toContain('datetime="2026-10-12T01:00:00.000Z"');
    expect(html).toContain("data-local-date");
    expect(html).toContain('data-lang-switch="ja"');
    expect(html).toContain('href="/ja/"');
  });
});

export { exists, read };

describe("post pages", () => {
  it("renders a Vietnamese post with highlighted code and no translation switch", () => {
    const html = read("vi/posts/hoc-aws-lambda-tu-con-so-0/index.html");
    expect(html).toContain("Học AWS Lambda từ con số 0");
    expect(html).toContain("--shiki-dark");
    expect(html).toContain("1 phút đọc");
    expect(html).not.toContain("data-version-switch");
  });

  it("shows a Vietnamese-only post under /ja/ with a notice and the right lang", () => {
    const html = read("ja/posts/hoc-aws-lambda-tu-con-so-0/index.html");
    expect(html).toContain('<html lang="ja"');
    expect(html).toContain('<article lang="vi"');
    expect(html).toContain("この記事はベトナム語のみです。");
  });

  it("links both published versions of a translated post", () => {
    const html = read("vi/posts/mua-thu-dau-tien-o-tokyo/index.html");
    expect(html).toContain("data-version-switch");
    expect(html).toContain('href="/ja/posts/tokyo-autumn/"');
    expect(html).toContain('src="/media/2026/autumn.webp"');
    expect(exists("ja/posts/tokyo-autumn/index.html")).toBe(true);
  });

  it("never publishes drafts or draft translations", () => {
    expect(exists("vi/posts/ban-nhap/index.html")).toBe(false);
    expect(exists("ja/posts/dynamodb-ja/index.html")).toBe(false);
    const html = read("vi/posts/dynamodb-single-table-design/index.html");
    expect(html).not.toContain("data-version-switch");
    expect(exists("ja/posts/dynamodb-single-table-design/index.html")).toBe(true);
  });
});

describe("tag pages and 404", () => {
  it("lists tags with names per language and counts", () => {
    const html = read("vi/tags/index.html");
    expect(html).toContain("đời sống");
    expect(html).toContain('href="/vi/tags/aws/"');
    expect(html).toContain("2 bài");
  });

  it("lists posts of a tag under its localized name", () => {
    const html = read("ja/tags/life/index.html");
    expect(html).toContain("暮らし");
    expect(html).toContain("東京で迎える初めての秋");
    expect(html).toContain("日本語のメモ");
    expect(html).not.toContain("Học AWS Lambda");
  });

  it("has a bilingual 404 page", () => {
    const html = read("404.html");
    expect(html).toContain('href="/vi/"');
    expect(html).toContain('href="/ja/"');
    expect(html).toContain("ページが見つかりません");
    expect(html).toContain("Không tìm thấy trang");
  });
});

describe("search", () => {
  it("loads search pages without the client router so Pagefind always initialises", () => {
    expect(read("vi/index.html")).toContain("astro-view-transitions-enabled");
    expect(read("ja/search/index.html")).not.toContain("astro-view-transitions-enabled");
  });

  it("keeps post meta, the version switch and the notice out of the search index", () => {
    const html = read("ja/posts/hoc-aws-lambda-tu-con-so-0/index.html");
    expect(html).toMatch(/class="meta"[^>]*data-pagefind-ignore/);
    expect(html).toMatch(/class="notice"[^>]*data-pagefind-ignore/);
    const both = read("vi/posts/mua-thu-dau-tien-o-tokyo/index.html");
    expect(both).toMatch(
      /data-version-switch[^>]*data-pagefind-ignore|data-pagefind-ignore[^>]*data-version-switch/,
    );
  });

  it("builds one Pagefind index per UI language", () => {
    expect(exists("pagefind/pagefind.js")).toBe(true);
    const entry = JSON.parse(read("pagefind/pagefind-entry.json"));
    expect(Object.keys(entry.languages).sort()).toEqual(["ja", "vi"]);
  });

  it("serves a search page per language that loads the Pagefind UI", () => {
    const html = read("ja/search/index.html");
    expect(html).toContain('<html lang="ja"');
    expect(html).toContain("/pagefind/pagefind-ui.js");
    expect(html).toContain('id="search"');
  });
});
