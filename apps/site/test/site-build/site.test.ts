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
