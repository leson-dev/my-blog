import { describe, expect, it } from "vitest";
import { displayTitle, filterPosts, pickLang, versionBadges } from "../../src/lib/posts";
import { makePost, makeVersion, summaryOf } from "../fixtures";

const viOnly = summaryOf(
  makePost({
    id: "A",
    updatedAt: "2026-10-01T00:00:00Z",
    versions: { vi: makeVersion({ title: "Học AWS" }) },
  }),
);
const jaOnly = summaryOf(
  makePost({
    id: "B",
    updatedAt: "2026-10-03T00:00:00Z",
    versions: { ja: makeVersion({ title: "紅葉の季節", status: "published" }) },
  }),
);
const both = summaryOf(
  makePost({
    id: "C",
    updatedAt: "2026-10-02T00:00:00Z",
    versions: {
      vi: makeVersion({ title: "Mùa thu", status: "scheduled" }),
      ja: makeVersion({ title: "秋", status: "draft" }),
    },
  }),
);
const all = [viOnly, jaOnly, both];

describe("posts helpers", () => {
  it("titles a post by its vi version, else ja", () => {
    expect(displayTitle(both)).toBe("Mùa thu");
    expect(displayTitle(jaOnly)).toBe("紅葉の季節");
  });

  it("lists newest first", () => {
    expect(filterPosts(all, { status: "all", query: "" }).map((p) => p.id)).toEqual([
      "B",
      "C",
      "A",
    ]);
  });

  it("filters by the status of any version", () => {
    expect(filterPosts(all, { status: "draft", query: "" }).map((p) => p.id)).toEqual(["C", "A"]);
    expect(filterPosts(all, { status: "scheduled", query: "" }).map((p) => p.id)).toEqual(["C"]);
  });

  it("searches both titles, ignoring Vietnamese accents and case", () => {
    expect(filterPosts(all, { status: "all", query: "hoc aws" }).map((p) => p.id)).toEqual(["A"]);
    expect(filterPosts(all, { status: "all", query: "秋" }).map((p) => p.id)).toEqual(["C"]);
  });

  it("labels each language", () => {
    expect(versionBadges(jaOnly).map((b) => b.text)).toEqual(["vi: —", "ja: đã đăng"]);
  });

  it("picks the requested tab when that version exists, else vi, else ja", () => {
    const full = makePost({ versions: { vi: makeVersion(), ja: makeVersion() } });
    expect(pickLang(full, "ja")).toBe("ja");
    expect(pickLang(full, "xx")).toBe("vi");
    expect(pickLang(makePost({ versions: { ja: makeVersion() } }), "vi")).toBe("ja");
  });
});
