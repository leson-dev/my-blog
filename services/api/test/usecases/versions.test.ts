import { describe, expect, it } from "vitest";
import { createPost, getPost } from "../../src/usecases/posts";
import { publishVersion } from "../../src/usecases/publishing";
import { deleteVersion, upsertVersion } from "../../src/usecases/versions";
import { makeDeps } from "../fakes";

const FUTURE = { publishAt: "2026-10-12T08:00:00Z" };

const setup = async () => {
  const deps = makeDeps();
  const post = await createPost(deps, {
    lang: "vi",
    title: "Học AWS",
    excerpt: "",
    content: "",
    tags: [],
    coverImage: null,
  });
  return { deps, post };
};
const ja = (version: number, extra: Record<string, string> = {}) => ({
  title: "AWSを学ぶ",
  excerpt: "",
  content: "本文",
  version,
  ...extra,
});

describe("upsertVersion", () => {
  it("adds a ja draft without building", async () => {
    const { deps, post } = await setup();
    const next = await upsertVersion(deps, post.id, "ja", ja(1));
    expect(next.versions.ja?.status).toBe("draft");
    expect(deps.buildQueue.reasons).toEqual([]);
  });

  it("does not build while editing a ja draft of a post whose vi is published", async () => {
    const { deps, post } = await setup();
    const published = await publishVersion(deps, post.id, "vi", {});
    const withJa = await upsertVersion(deps, post.id, "ja", ja(published.version));
    deps.buildQueue.reasons.length = 0;
    await upsertVersion(deps, post.id, "ja", ja(withJa.version, { content: "もっと" }));
    expect(deps.buildQueue.reasons).toEqual([]);
  });

  it("builds when a published version is edited", async () => {
    const { deps, post } = await setup();
    const published = await publishVersion(deps, post.id, "vi", {});
    deps.buildQueue.reasons.length = 0;
    await upsertVersion(deps, post.id, "vi", {
      title: "Mới",
      excerpt: "",
      content: "x",
      version: published.version,
    });
    expect(deps.buildQueue.reasons).toEqual([`update:${post.id}:vi`]);
  });

  it("rejects a ja slug already used by another post's vi version", async () => {
    const { deps } = await setup();
    const other = await createPost(deps, {
      lang: "vi",
      title: "Khác",
      excerpt: "",
      content: "",
      tags: [],
      coverImage: null,
    });
    await expect(
      upsertVersion(deps, other.id, "ja", ja(1, { slug: "hoc-aws" })),
    ).rejects.toMatchObject({ code: "SLUG_TAKEN" });
  });

  it("rejects a ja slug equal to the same post's vi slug", async () => {
    const { deps, post } = await setup();
    await expect(
      upsertVersion(deps, post.id, "ja", ja(1, { slug: "hoc-aws" })),
    ).rejects.toMatchObject({ code: "SLUG_TAKEN" });
  });

  it("forbids the e2e caller on a post with a published version", async () => {
    const { deps, post } = await setup();
    const published = await publishVersion(deps, post.id, "vi", {});
    await expect(
      upsertVersion(deps, post.id, "ja", ja(published.version), { e2e: true }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("deleteVersion", () => {
  it("removes one of two versions", async () => {
    const { deps, post } = await setup();
    await upsertVersion(deps, post.id, "ja", ja(1));
    await deleteVersion(deps, post.id, "ja");
    expect((await getPost(deps, post.id)).versions.ja).toBeUndefined();
  });

  it("refuses to delete the only version", async () => {
    const { deps, post } = await setup();
    await expect(deleteVersion(deps, post.id, "vi")).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
  });

  it("cancels the schedule of a scheduled version without building", async () => {
    const { deps, post } = await setup();
    await upsertVersion(deps, post.id, "ja", ja(1));
    await publishVersion(deps, post.id, "ja", FUTURE);
    await deleteVersion(deps, post.id, "ja");
    expect(deps.scheduler.cancelled).toEqual([`${post.id}:ja`]);
    expect(deps.buildQueue.reasons).toEqual([]);
  });

  it("builds when a published version is deleted", async () => {
    const { deps, post } = await setup();
    const withJa = await upsertVersion(deps, post.id, "ja", ja(1));
    await publishVersion(deps, post.id, "ja", {});
    deps.buildQueue.reasons.length = 0;
    expect(withJa.versions.ja).toBeDefined();
    await deleteVersion(deps, post.id, "ja");
    expect(deps.buildQueue.reasons).toEqual([`delete:${post.id}:ja`]);
  });
});
