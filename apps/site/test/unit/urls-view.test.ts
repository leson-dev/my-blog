import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSiteData } from "../../src/lib/data";
import { urls } from "../../src/lib/urls";
import { byYear, pagesWithTag, postPage, postPages, tagEntries, tagName } from "../../src/lib/view";

const { posts, tags } = loadSiteData(resolve(__dirname, "../../fixtures"));
const byId = (id: string) => {
  const post = posts.find((p) => p.id === id);
  if (!post) throw new Error(id);
  return post;
};

describe("urls", () => {
  it("builds trailing-slash URLs with a language prefix", () => {
    expect(urls.home("ja")).toBe("/ja/");
    expect(urls.post("vi", "a")).toBe("/vi/posts/a/");
    expect(urls.tags("vi")).toBe("/vi/tags/");
    expect(urls.tag("ja", "life")).toBe("/ja/tags/life/");
    expect(urls.search("vi")).toBe("/vi/search/");
  });
});

describe("postPage", () => {
  it("shows the UI language version when it is published", () => {
    const page = postPage(byId("P2"), "ja");
    expect(page).toMatchObject({ lang: "ja", url: "/ja/posts/tokyo-autumn/" });
    expect(page?.version.title).toBe("東京で迎える初めての秋");
    expect(page?.altUrl).toBe("/vi/posts/mua-thu-dau-tien-o-tokyo/");
    expect(page?.translationUrl).toBe("/vi/posts/mua-thu-dau-tien-o-tokyo/");
  });

  it("falls back to the other language under the same UI, without a translation link", () => {
    const page = postPage(byId("P1"), "ja");
    expect(page).toMatchObject({
      ui: "ja",
      lang: "vi",
      url: "/ja/posts/hoc-aws-lambda-tu-con-so-0/",
      altUrl: "/vi/posts/hoc-aws-lambda-tu-con-so-0/",
      translationUrl: null,
    });
  });

  it("ignores a draft translation", () => {
    const page = postPage(byId("P5"), "ja");
    expect(page).toMatchObject({ lang: "vi", translationUrl: null });
    expect(postPage(byId("P5"), "vi")?.translationUrl).toBeNull();
  });

  it("returns null for a post with nothing published", () => {
    expect(postPage(byId("P4"), "vi")).toBeNull();
    expect(postPage(byId("P4"), "ja")).toBeNull();
  });
});

describe("postPages / byYear", () => {
  it("lists every post with a published version once, newest first", () => {
    expect(postPages(posts, "vi").map((p) => p.post.id)).toEqual(["P1", "P2", "P3", "P5"]);
  });

  it("groups by UTC year", () => {
    const groups = byYear(postPages(posts, "ja"));
    expect(groups.map((g) => [g.year, g.pages.map((p) => p.post.id)])).toEqual([
      ["2026", ["P1", "P2"]],
      ["2025", ["P3", "P5"]],
    ]);
  });
});

describe("tags", () => {
  it("names tags per language and falls back to the key", () => {
    expect(tagName(tags, "life", "ja")).toBe("暮らし");
    expect(tagName(tags, "aws", "ja")).toBe("aws");
  });

  it("counts only posts visible on the site", () => {
    const pages = postPages(posts, "vi");
    expect(tagEntries(pages, tags, "vi")).toEqual([
      { key: "aws", name: "aws", count: 2, url: "/vi/tags/aws/" },
      { key: "life", name: "đời sống", count: 2, url: "/vi/tags/life/" },
    ]);
    expect(pagesWithTag(pages, "life").map((p) => p.post.id)).toEqual(["P2", "P3"]);
  });
});
