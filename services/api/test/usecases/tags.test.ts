import { describe, expect, it } from "vitest";
import { createPost } from "../../src/usecases/posts";
import { publishVersion } from "../../src/usecases/publishing";
import { listTags, putTag } from "../../src/usecases/tags";
import { makeDeps } from "../fakes";

const post = (deps: ReturnType<typeof makeDeps>, title: string, tags: string[]) =>
  createPost(deps, { lang: "vi", title, excerpt: "", content: "", tags, coverImage: null });

describe("listTags", () => {
  it("merges tags used by posts with named tags and counts posts", async () => {
    const deps = makeDeps();
    await post(deps, "A", ["aws", "life"]);
    await post(deps, "B", ["life"]);
    await deps.tags.put({ key: "life", names: { vi: "đời sống", ja: "暮らし" } });
    await deps.tags.put({ key: "travel", names: { ja: "旅" } });
    expect(await listTags(deps)).toEqual([
      { key: "aws", names: {}, postCount: 1 },
      { key: "life", names: { vi: "đời sống", ja: "暮らし" }, postCount: 2 },
      { key: "travel", names: { ja: "旅" }, postCount: 0 },
    ]);
  });
});

describe("putTag", () => {
  it("stores names for a valid key", async () => {
    const deps = makeDeps();
    const tag = await putTag(deps, "life", { names: { ja: "暮らし" } });
    expect(tag).toEqual({ key: "life", names: { ja: "暮らし" } });
    expect(await deps.tags.list()).toEqual([tag]);
  });

  it("rejects an invalid key", async () => {
    await expect(putTag(makeDeps(), "Bad Key", { names: {} })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("builds only when a post with a published version uses the tag", async () => {
    const deps = makeDeps();
    const draft = await post(deps, "Draft", ["life"]);
    await putTag(deps, "life", { names: { vi: "đời sống" } });
    expect(deps.buildQueue.reasons).toEqual([]);
    await publishVersion(deps, draft.id, "vi", {});
    deps.buildQueue.reasons.length = 0;
    await putTag(deps, "life", { names: { vi: "cuộc sống" } });
    expect(deps.buildQueue.reasons).toEqual(["tag:life"]);
  });

  it("forbids the e2e caller on a tag used by a live post, allows it otherwise", async () => {
    const deps = makeDeps();
    const live = await post(deps, "Live", ["life"]);
    await post(deps, "Draft", ["e2e-tag"]);
    await publishVersion(deps, live.id, "vi", { publishAt: "2026-10-12T08:00:00Z" });
    await expect(putTag(deps, "life", { names: { vi: "x" } }, { e2e: true })).rejects.toMatchObject(
      {
        code: "FORBIDDEN",
      },
    );
    await expect(
      putTag(deps, "e2e-tag", { names: { vi: "x" } }, { e2e: true }),
    ).resolves.toBeDefined();
  });
});
