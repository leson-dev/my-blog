import type { Post } from "@blog/shared";
import { describe, expect, it } from "vitest";
import {
  applyVersion,
  isLive,
  needsRebuild,
  newPost,
  publish,
  publishScheduled,
  scheduledLangs,
  slugEntries,
  toSummary,
  unpublish,
  updateShared,
  withoutVersion,
} from "../../src/domain/post";

const NOW = "2026-10-10T00:00:00.000Z";
const LATER = "2026-10-11T00:00:00.000Z";
const ID = "01JABCDEFGHJKMNPQRSTVWXYZ0";
const FUTURE = "2026-10-12T08:00:00Z";

const viDraft = (): Post =>
  newPost(
    { lang: "vi", title: "Học AWS", excerpt: "", content: "# Hi", tags: ["AWS"], coverImage: null },
    { id: ID, now: NOW },
  );
const jaInput = (version: number) => ({
  title: "AWSを学ぶ",
  excerpt: "",
  content: "# こんにちは",
  version,
});

describe("newPost", () => {
  it("creates a post with one draft version at post version 1", () => {
    expect(viDraft()).toEqual({
      id: ID,
      tags: ["aws"],
      coverImage: null,
      createdAt: NOW,
      updatedAt: NOW,
      version: 1,
      versions: {
        vi: {
          slug: "hoc-aws",
          title: "Học AWS",
          excerpt: "",
          content: "# Hi",
          status: "draft",
          publishAt: null,
          publishedAt: null,
          updatedAt: NOW,
        },
      },
    });
  });

  it("falls back to <id>-<lang> when the title has no latin characters", () => {
    const post = newPost(
      { lang: "ja", title: "東京の秋", excerpt: "", content: "", tags: [], coverImage: null },
      { id: ID, now: NOW },
    );
    expect(post.versions.ja?.slug).toBe(`${ID.toLowerCase()}-ja`);
  });

  it("normalizes an explicit slug and rejects one without latin characters", () => {
    const make = (slug: string) =>
      newPost(
        { lang: "vi", title: "x", slug, excerpt: "", content: "", tags: [], coverImage: null },
        { id: ID, now: NOW },
      );
    expect(make("My Custom Slug").versions.vi?.slug).toBe("my-custom-slug");
    expect(() => make("日本")).toThrowError(expect.objectContaining({ code: "VALIDATION_ERROR" }));
  });
});

describe("updateShared", () => {
  it("replaces tags and cover image and bumps the version", () => {
    const next = updateShared(
      viDraft(),
      { tags: ["Life"], coverImage: "/media/a.webp", version: 1 },
      LATER,
    );
    expect(next).toMatchObject({
      tags: ["life"],
      coverImage: "/media/a.webp",
      version: 2,
      updatedAt: LATER,
    });
  });

  it("throws VERSION_CONFLICT on a stale version", () => {
    expect(() =>
      updateShared(viDraft(), { tags: [], coverImage: null, version: 7 }, LATER),
    ).toThrowError(expect.objectContaining({ code: "VERSION_CONFLICT" }));
  });
});

describe("applyVersion", () => {
  it("adds a ja draft and leaves vi untouched", () => {
    const before = viDraft();
    const next = applyVersion(before, "ja", jaInput(1), LATER);
    expect(next.version).toBe(2);
    expect(next.versions.vi).toEqual(before.versions.vi);
    expect(next.versions.ja).toMatchObject({
      title: "AWSを学ぶ",
      slug: "aws",
      status: "draft",
      updatedAt: LATER,
    });
  });

  it("keeps status, publish dates and slug when editing an existing version without a slug", () => {
    const published = publish(viDraft(), "vi", undefined, NOW);
    const next = applyVersion(
      published,
      "vi",
      { title: "Tiêu đề mới", excerpt: "e", content: "c", version: published.version },
      LATER,
    );
    expect(next.versions.vi).toMatchObject({
      title: "Tiêu đề mới",
      slug: "hoc-aws",
      status: "published",
      publishedAt: NOW,
    });
  });

  it("normalizes an explicit new slug", () => {
    const next = applyVersion(
      viDraft(),
      "vi",
      { ...jaInput(1), title: "x", slug: "New Slug" },
      LATER,
    );
    expect(next.versions.vi?.slug).toBe("new-slug");
  });

  it("throws VERSION_CONFLICT on a stale version", () => {
    expect(() => applyVersion(viDraft(), "ja", jaInput(5), LATER)).toThrowError(
      expect.objectContaining({ code: "VERSION_CONFLICT" }),
    );
  });
});

describe("withoutVersion", () => {
  it("removes one of two versions", () => {
    const both = applyVersion(viDraft(), "ja", jaInput(1), NOW);
    const next = withoutVersion(both, "ja", LATER);
    expect(next.versions.ja).toBeUndefined();
    expect(next.versions.vi).toBeDefined();
    expect(next.version).toBe(3);
  });

  it("refuses to remove the only version", () => {
    expect(() => withoutVersion(viDraft(), "vi", LATER)).toThrowError(
      expect.objectContaining({ code: "INVALID_STATE" }),
    );
  });

  it("throws NOT_FOUND for a missing version", () => {
    expect(() => withoutVersion(viDraft(), "ja", LATER)).toThrowError(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
  });
});

describe("publish", () => {
  it("publishes one language now and leaves the other untouched", () => {
    const both = applyVersion(viDraft(), "ja", jaInput(1), NOW);
    const next = publish(both, "vi", undefined, LATER);
    expect(next.versions.vi).toMatchObject({
      status: "published",
      publishedAt: LATER,
      publishAt: null,
    });
    expect(next.versions.ja?.status).toBe("draft");
  });

  it("publishes immediately for past times and times within 60 seconds", () => {
    expect(publish(viDraft(), "vi", "2026-10-09T00:00:00Z", NOW).versions.vi?.status).toBe(
      "published",
    );
    expect(publish(viDraft(), "vi", "2026-10-10T00:00:59Z", NOW).versions.vi?.status).toBe(
      "published",
    );
  });

  it("schedules future times truncated to the second, and allows rescheduling", () => {
    const scheduled = publish(viDraft(), "vi", "2026-10-12T08:00:00.123Z", NOW);
    expect(scheduled.versions.vi).toMatchObject({
      status: "scheduled",
      publishAt: "2026-10-12T08:00:00.000Z",
    });
    const moved = publish(scheduled, "vi", "2026-10-13T08:00:00Z", NOW);
    expect(moved.versions.vi?.publishAt).toBe("2026-10-13T08:00:00.000Z");
  });

  it("refuses to publish an already published version", () => {
    const published = publish(viDraft(), "vi", undefined, NOW);
    expect(() => publish(published, "vi", undefined, NOW)).toThrowError(
      expect.objectContaining({ code: "INVALID_STATE" }),
    );
  });

  it("keeps the first publishedAt when republishing", () => {
    const first = publish(viDraft(), "vi", undefined, NOW);
    const again = publish(
      unpublish(first, "vi", LATER),
      "vi",
      undefined,
      "2026-10-12T00:00:00.000Z",
    );
    expect(again.versions.vi?.publishedAt).toBe(NOW);
  });

  it("throws NOT_FOUND for a missing version", () => {
    expect(() => publish(viDraft(), "ja", undefined, NOW)).toThrowError(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
  });
});

describe("unpublish", () => {
  it("moves a scheduled version back to draft", () => {
    const scheduled = publish(viDraft(), "vi", FUTURE, NOW);
    expect(unpublish(scheduled, "vi", NOW).versions.vi).toMatchObject({
      status: "draft",
      publishAt: null,
    });
  });

  it("refuses to unpublish a draft", () => {
    expect(() => unpublish(viDraft(), "vi", NOW)).toThrowError(
      expect.objectContaining({ code: "INVALID_STATE" }),
    );
  });
});

describe("publishScheduled", () => {
  const scheduled = publish(viDraft(), "vi", FUTURE, NOW);

  it("publishes the matching language at the scheduled time", () => {
    const next = publishScheduled(scheduled, "vi", "2026-10-12T08:00:00.000Z", LATER);
    expect(next?.versions.vi).toMatchObject({
      status: "published",
      publishAt: null,
      publishedAt: "2026-10-12T08:00:00.000Z",
    });
  });

  it("ignores a stale time, another language, or a version that is no longer scheduled", () => {
    expect(publishScheduled(scheduled, "vi", "2026-10-11T08:00:00.000Z", LATER)).toBeNull();
    expect(publishScheduled(scheduled, "ja", "2026-10-12T08:00:00.000Z", LATER)).toBeNull();
    expect(
      publishScheduled(unpublish(scheduled, "vi", NOW), "vi", "2026-10-12T08:00:00.000Z", LATER),
    ).toBeNull();
  });
});

describe("needsRebuild", () => {
  const draft = viDraft();
  const published = publish(draft, "vi", undefined, NOW);
  const withJaDraft = applyVersion(published, "ja", jaInput(published.version), NOW);

  it.each([
    ["draft edit", draft, applyVersion(draft, "vi", { ...jaInput(1), title: "x" }, LATER), false],
    [
      "shared edit of a draft-only post",
      draft,
      updateShared(draft, { tags: ["x"], coverImage: null, version: 1 }, LATER),
      false,
    ],
    ["publish", draft, published, true],
    [
      "ja draft edit while vi is published",
      withJaDraft,
      applyVersion(withJaDraft, "ja", { ...jaInput(withJaDraft.version), content: "more" }, LATER),
      false,
    ],
    [
      "published vi edit",
      published,
      applyVersion(published, "vi", { ...jaInput(published.version), title: "x" }, LATER),
      true,
    ],
    [
      "shared edit of a published post",
      published,
      updateShared(published, { tags: ["x"], coverImage: null, version: published.version }, LATER),
      true,
    ],
    ["unpublish", published, unpublish(published, "vi", LATER), true],
    ["delete published", published, null, true],
    ["delete draft", draft, null, false],
  ] as const)("%s -> %s", (_name, before, after, expected) => {
    expect(needsRebuild(before, after)).toBe(expected);
  });
});

describe("isLive / scheduledLangs / slugEntries / toSummary", () => {
  const both = applyVersion(viDraft(), "ja", jaInput(1), NOW);

  it("isLive is true when any version is published or scheduled", () => {
    expect(isLive(both)).toBe(false);
    expect(isLive(publish(both, "ja", FUTURE, NOW))).toBe(true);
    expect(isLive(publish(both, "vi", undefined, NOW))).toBe(true);
  });

  it("lists scheduled languages and slugs", () => {
    expect(scheduledLangs(publish(both, "ja", FUTURE, NOW))).toEqual(["ja"]);
    expect(slugEntries(both)).toEqual([
      { lang: "vi", slug: "hoc-aws" },
      { lang: "ja", slug: "aws" },
    ]);
  });

  it("toSummary drops content from every version", () => {
    const summary = toSummary(both);
    expect(summary.versions.vi).not.toHaveProperty("content");
    expect(summary.versions.ja).not.toHaveProperty("content");
    expect(summary.versions.ja?.title).toBe("AWSを学ぶ");
  });
});
