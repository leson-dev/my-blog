import type { Post } from "@blog/shared";
import { describe, expect, it } from "vitest";
import {
  applyUpdate,
  needsRebuild,
  newPost,
  publish,
  publishScheduled,
  toSummary,
  unpublish,
} from "../../src/domain/post";

const NOW = "2026-10-10T00:00:00.000Z";
const ID = "01JABCDEFGHJKMNPQRSTVWXYZ0";

const draft = (overrides: Partial<Post> = {}): Post => ({
  ...newPost(
    { title: "Học AWS", excerpt: "", content: "# Hi", tags: ["AWS"], coverImage: null },
    { id: ID, now: NOW },
  ),
  ...overrides,
});

describe("newPost", () => {
  it("creates a draft at version 1 with a slug from the title", () => {
    expect(draft()).toEqual({
      id: ID,
      slug: "hoc-aws",
      title: "Học AWS",
      excerpt: "",
      content: "# Hi",
      tags: ["aws"],
      coverImage: null,
      status: "draft",
      publishAt: null,
      publishedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
      version: 1,
    });
  });

  it("falls back to the lowercase id when the title has no latin characters", () => {
    const post = newPost(
      { title: "日本語のタイトル", excerpt: "", content: "", tags: [], coverImage: null },
      { id: ID, now: NOW },
    );
    expect(post.slug).toBe(ID.toLowerCase());
  });

  it("normalizes an explicit slug", () => {
    const post = newPost(
      { title: "x", slug: "My Custom Slug", excerpt: "", content: "", tags: [], coverImage: null },
      { id: ID, now: NOW },
    );
    expect(post.slug).toBe("my-custom-slug");
  });

  it("rejects an explicit slug with no latin characters", () => {
    expect(() =>
      newPost(
        { title: "x", slug: "日本", excerpt: "", content: "", tags: [], coverImage: null },
        { id: ID, now: NOW },
      ),
    ).toThrowError(expect.objectContaining({ code: "VALIDATION_ERROR" }));
  });
});

describe("applyUpdate", () => {
  const input = {
    title: "New title",
    slug: "new-title",
    excerpt: "e",
    content: "c",
    tags: ["Astro"],
    coverImage: "/media/2026/a.webp",
    version: 1,
  };

  it("replaces editable fields and bumps the version", () => {
    const next = applyUpdate(draft(), input, "2026-10-11T00:00:00.000Z");
    expect(next).toMatchObject({
      title: "New title",
      slug: "new-title",
      tags: ["astro"],
      coverImage: "/media/2026/a.webp",
      updatedAt: "2026-10-11T00:00:00.000Z",
      version: 2,
      status: "draft",
    });
  });

  it("throws VERSION_CONFLICT when the client version is stale", () => {
    expect(() => applyUpdate(draft({ version: 3 }), input, NOW)).toThrowError(
      expect.objectContaining({ code: "VERSION_CONFLICT" }),
    );
  });
});

describe("publish", () => {
  it("publishes immediately when no publishAt is given", () => {
    const next = publish(draft(), undefined, NOW);
    expect(next).toMatchObject({
      status: "published",
      publishedAt: NOW,
      publishAt: null,
      version: 2,
    });
  });

  it("publishes immediately when publishAt is in the past", () => {
    expect(publish(draft(), "2026-10-09T00:00:00Z", NOW).status).toBe("published");
  });

  it("publishes immediately when publishAt is within 60 seconds", () => {
    expect(publish(draft(), "2026-10-10T00:00:59Z", NOW).status).toBe("published");
  });

  it("schedules when publishAt is further in the future, truncated to the second", () => {
    const next = publish(draft(), "2026-10-12T08:00:00.123Z", NOW);
    expect(next).toMatchObject({
      status: "scheduled",
      publishAt: "2026-10-12T08:00:00.000Z",
      publishedAt: null,
    });
  });

  it("allows rescheduling a scheduled post", () => {
    const scheduled = publish(draft(), "2026-10-12T08:00:00Z", NOW);
    const moved = publish(scheduled, "2026-10-13T08:00:00Z", NOW);
    expect(moved.publishAt).toBe("2026-10-13T08:00:00.000Z");
  });

  it("refuses to publish an already published post", () => {
    const published = publish(draft(), undefined, NOW);
    expect(() => publish(published, undefined, NOW)).toThrowError(
      expect.objectContaining({ code: "INVALID_STATE" }),
    );
  });

  it("keeps the original publishedAt when republishing after an unpublish", () => {
    const first = publish(draft(), undefined, NOW);
    const back = unpublish(first, "2026-10-11T00:00:00.000Z");
    const again = publish(back, undefined, "2026-10-12T00:00:00.000Z");
    expect(again.publishedAt).toBe(NOW);
  });
});

describe("unpublish", () => {
  it("moves a scheduled post back to draft and clears publishAt", () => {
    const scheduled = publish(draft(), "2026-10-12T08:00:00Z", NOW);
    expect(unpublish(scheduled, NOW)).toMatchObject({ status: "draft", publishAt: null });
  });

  it("refuses to unpublish a draft", () => {
    expect(() => unpublish(draft(), NOW)).toThrowError(
      expect.objectContaining({ code: "INVALID_STATE" }),
    );
  });
});

describe("publishScheduled", () => {
  const scheduled = publish(draft(), "2026-10-12T08:00:00Z", NOW);

  it("publishes when the event matches the stored publishAt", () => {
    const next = publishScheduled(
      scheduled,
      "2026-10-12T08:00:00.000Z",
      "2026-10-12T08:00:01.000Z",
    );
    expect(next).toMatchObject({
      status: "published",
      publishAt: null,
      publishedAt: "2026-10-12T08:00:00.000Z",
    });
  });

  it("ignores an event for a different time (post was rescheduled)", () => {
    expect(publishScheduled(scheduled, "2026-10-11T08:00:00.000Z", NOW)).toBeNull();
  });

  it("ignores an event when the post is no longer scheduled", () => {
    const back = unpublish(scheduled, NOW);
    expect(publishScheduled(back, "2026-10-12T08:00:00.000Z", NOW)).toBeNull();
  });
});

describe("needsRebuild", () => {
  const published = publish(draft(), undefined, NOW);
  const scheduled = publish(draft(), "2026-10-12T08:00:00Z", NOW);

  it.each([
    ["draft edit", draft(), draft({ title: "x" }), false],
    ["scheduled edit", scheduled, { ...scheduled, title: "x" }, false],
    ["publish", draft(), published, true],
    ["published edit", published, { ...published, title: "x" }, true],
    ["unpublish", published, draft(), true],
    ["delete published", published, null, true],
    ["delete draft", draft(), null, false],
  ] as const)("%s -> %s", (_name, before, after, expected) => {
    expect(needsRebuild(before, after)).toBe(expected);
  });
});

describe("toSummary", () => {
  it("drops the content field", () => {
    expect(toSummary(draft())).not.toHaveProperty("content");
  });
});
