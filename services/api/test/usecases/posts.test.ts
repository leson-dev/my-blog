import { describe, expect, it } from "vitest";
import { createPost, deletePost, getPost, listPosts, updatePost } from "../../src/usecases/posts";
import { publishPost } from "../../src/usecases/publishing";
import { makeDeps } from "../fakes";

const create = (deps: ReturnType<typeof makeDeps>, title = "Học AWS") =>
  createPost(deps, { title, excerpt: "", content: "body", tags: [], coverImage: null });

const editInput = (version: number) => ({
  title: "Học AWS (sửa)",
  slug: "hoc-aws",
  excerpt: "",
  content: "new body",
  tags: [],
  coverImage: null,
  version,
});

describe("createPost / getPost", () => {
  it("stores a draft that can be read back", async () => {
    const deps = makeDeps();
    const created = await create(deps);
    expect(await getPost(deps, created.id)).toEqual(created);
    expect(created.status).toBe("draft");
  });

  it("rejects a second post with the same slug", async () => {
    const deps = makeDeps();
    await create(deps);
    await expect(create(deps)).rejects.toMatchObject({ code: "SLUG_TAKEN" });
  });

  it("throws NOT_FOUND for an unknown id", async () => {
    await expect(getPost(makeDeps(), "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("listPosts", () => {
  it("returns summaries without content, newest update first", async () => {
    const deps = makeDeps();
    const first = await create(deps, "First");
    deps.clock.now = "2026-10-11T00:00:00.000Z";
    const second = await create(deps, "Second");
    const list = await listPosts(deps);
    expect(list.map((p) => p.id)).toEqual([second.id, first.id]);
    expect(list[0]).not.toHaveProperty("content");
  });
});

describe("updatePost", () => {
  it("saves a draft without requesting a build", async () => {
    const deps = makeDeps();
    const post = await create(deps);
    const updated = await updatePost(deps, post.id, editInput(1));
    expect(updated.version).toBe(2);
    expect(deps.buildQueue.reasons).toEqual([]);
  });

  it("requests a build when a published post changes", async () => {
    const deps = makeDeps();
    const post = await create(deps);
    const published = await publishPost(deps, post.id, {});
    deps.buildQueue.reasons.length = 0;
    await updatePost(deps, post.id, editInput(published.version));
    expect(deps.buildQueue.reasons).toEqual([`update:${post.id}`]);
  });

  it("rejects a stale version", async () => {
    const deps = makeDeps();
    const post = await create(deps);
    await updatePost(deps, post.id, editInput(1));
    await expect(updatePost(deps, post.id, editInput(1))).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });
  });
});

describe("deletePost", () => {
  it("deletes a draft without a build", async () => {
    const deps = makeDeps();
    const post = await create(deps);
    await deletePost(deps, post.id);
    await expect(getPost(deps, post.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(deps.buildQueue.reasons).toEqual([]);
  });

  it("cancels the schedule of a scheduled post", async () => {
    const deps = makeDeps();
    const post = await create(deps);
    await publishPost(deps, post.id, { publishAt: "2026-10-12T08:00:00Z" });
    await deletePost(deps, post.id);
    expect(deps.scheduler.cancelled).toEqual([post.id]);
    expect(deps.buildQueue.reasons).toEqual([]);
  });

  it("requests a build when deleting a published post", async () => {
    const deps = makeDeps();
    const post = await create(deps);
    await publishPost(deps, post.id, {});
    deps.buildQueue.reasons.length = 0;
    await deletePost(deps, post.id);
    expect(deps.buildQueue.reasons).toEqual([`delete:${post.id}`]);
  });
});
