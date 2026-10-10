import { describe, expect, it } from "vitest";
import { createPost, deletePost, getPost, listPosts, updatePost } from "../../src/usecases/posts";
import { publishVersion } from "../../src/usecases/publishing";
import { upsertVersion } from "../../src/usecases/versions";
import { makeDeps } from "../fakes";

const FUTURE = { publishAt: "2026-10-12T08:00:00Z" };
const E2E = { e2e: true };

const create = (deps: ReturnType<typeof makeDeps>, title = "Học AWS") =>
  createPost(deps, { lang: "vi", title, excerpt: "", content: "body", tags: [], coverImage: null });

describe("createPost / getPost / listPosts", () => {
  it("stores a post with one vi draft", async () => {
    const deps = makeDeps();
    const created = await create(deps);
    expect(await getPost(deps, created.id)).toEqual(created);
    expect(created.versions.vi?.status).toBe("draft");
  });

  it("rejects a second post with the same slug", async () => {
    const deps = makeDeps();
    await create(deps);
    await expect(create(deps)).rejects.toMatchObject({ code: "SLUG_TAKEN" });
  });

  it("throws NOT_FOUND for an unknown id", async () => {
    await expect(getPost(makeDeps(), "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lists summaries without content, newest update first", async () => {
    const deps = makeDeps();
    const first = await create(deps, "First");
    deps.clock.now = "2026-10-11T00:00:00.000Z";
    const second = await create(deps, "Second");
    const list = await listPosts(deps);
    expect(list.map((p) => p.id)).toEqual([second.id, first.id]);
    expect(list[0]?.versions.vi).not.toHaveProperty("content");
  });
});

describe("updatePost (shared fields)", () => {
  it("does not build for a draft-only post", async () => {
    const deps = makeDeps();
    const post = await create(deps);
    const next = await updatePost(deps, post.id, { tags: ["life"], coverImage: null, version: 1 });
    expect(next.tags).toEqual(["life"]);
    expect(deps.buildQueue.reasons).toEqual([]);
  });

  it("builds when the post has a published version", async () => {
    const deps = makeDeps();
    const post = await create(deps);
    const published = await publishVersion(deps, post.id, "vi", {});
    deps.buildQueue.reasons.length = 0;
    await updatePost(deps, post.id, {
      tags: ["life"],
      coverImage: null,
      version: published.version,
    });
    expect(deps.buildQueue.reasons).toEqual([`update:${post.id}`]);
  });

  it("returns the saved post when the build queue is down", async () => {
    const deps = makeDeps();
    const post = await create(deps);
    const published = await publishVersion(deps, post.id, "vi", {});
    deps.buildQueue.failWith = new Error("SQS down");
    const saved = await updatePost(deps, post.id, {
      tags: ["life"],
      coverImage: null,
      version: published.version,
    });
    expect((await getPost(deps, post.id)).version).toBe(saved.version);
    expect(deps.builds.state.status).toBe("failed");
    expect(deps.log.errors).toHaveLength(1);
  });

  it("rejects a stale version", async () => {
    const deps = makeDeps();
    const post = await create(deps);
    await updatePost(deps, post.id, { tags: [], coverImage: null, version: 1 });
    await expect(
      updatePost(deps, post.id, { tags: [], coverImage: null, version: 1 }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });
});

describe("deletePost", () => {
  it("deletes a draft-only post without building", async () => {
    const deps = makeDeps();
    const post = await create(deps);
    await deletePost(deps, post.id);
    await expect(getPost(deps, post.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(deps.buildQueue.reasons).toEqual([]);
  });

  it("cancels every scheduled version and builds when something was published", async () => {
    const deps = makeDeps();
    const post = await create(deps);
    const p1 = await publishVersion(deps, post.id, "vi", {});
    const p2 = await upsertVersion(deps, post.id, "ja", {
      title: "AWS",
      excerpt: "",
      content: "",
      version: p1.version,
    });
    await publishVersion(deps, post.id, "ja", FUTURE);
    deps.buildQueue.reasons.length = 0;
    expect(p2.versions.ja).toBeDefined();
    await deletePost(deps, post.id);
    expect(deps.scheduler.cancelled).toEqual([`${post.id}:ja`]);
    expect(deps.buildQueue.reasons).toEqual([`delete:${post.id}`]);
  });

  it("succeeds when cancelling the schedule fails", async () => {
    const deps = makeDeps();
    const post = await create(deps);
    await publishVersion(deps, post.id, "vi", FUTURE);
    deps.scheduler.cancelFailWith = new Error("throttled");
    await deletePost(deps, post.id);
    await expect(getPost(deps, post.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(deps.log.errors).toHaveLength(1);
  });
});

describe("e2e caller", () => {
  it("may edit and delete a post with nothing published or scheduled", async () => {
    const deps = makeDeps();
    const post = await create(deps);
    await updatePost(deps, post.id, { tags: [], coverImage: null, version: 1 }, E2E);
    await deletePost(deps, post.id, E2E);
  });

  it.each([
    ["published", {}],
    ["scheduled", FUTURE],
  ])("may not edit or delete a post with a %s version", async (_s, body) => {
    const deps = makeDeps();
    const post = await create(deps);
    const live = await publishVersion(deps, post.id, "vi", body);
    await expect(
      updatePost(deps, post.id, { tags: [], coverImage: null, version: live.version }, E2E),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(deletePost(deps, post.id, E2E)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
