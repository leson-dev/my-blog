import { describe, expect, it } from "vitest";
import { createPost, deletePost, getPost, updatePost } from "../../src/usecases/posts";
import { publishPost, runScheduledPublish, unpublishPost } from "../../src/usecases/publishing";
import { makeDeps } from "../fakes";

// Once a write is committed, follow-up side effects (cancel schedule, queue build) are
// best-effort: they are logged and never turn the committed write into an error.

const setup = async () => {
  const deps = makeDeps();
  const post = await createPost(deps, {
    title: "Học AWS",
    excerpt: "",
    content: "",
    tags: [],
    coverImage: null,
  });
  return { deps, post };
};

const SCHEDULE = { publishAt: "2026-10-12T08:00:00Z" };

describe("side effects after a committed write", () => {
  it("publishing a scheduled post now still builds when cancelling the schedule fails", async () => {
    const { deps, post } = await setup();
    await publishPost(deps, post.id, SCHEDULE);
    deps.scheduler.cancelFailWith = new Error("throttled");
    const next = await publishPost(deps, post.id, {});
    expect(next.status).toBe("published");
    expect(deps.buildQueue.reasons).toEqual([`publish:${post.id}`]);
    expect(deps.log.errors).toHaveLength(1);
  });

  it("unpublishing a scheduled post succeeds when cancelling the schedule fails", async () => {
    const { deps, post } = await setup();
    await publishPost(deps, post.id, SCHEDULE);
    deps.scheduler.cancelFailWith = new Error("throttled");
    expect((await unpublishPost(deps, post.id)).status).toBe("draft");
    expect(deps.log.errors).toHaveLength(1);
  });

  it("deleting a scheduled post succeeds when cancelling the schedule fails", async () => {
    const { deps, post } = await setup();
    await publishPost(deps, post.id, SCHEDULE);
    deps.scheduler.cancelFailWith = new Error("throttled");
    await deletePost(deps, post.id);
    await expect(getPost(deps, post.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("saving a published post returns the saved post when the build queue is down", async () => {
    const { deps, post } = await setup();
    const published = await publishPost(deps, post.id, {});
    deps.buildQueue.failWith = new Error("SQS down");
    const saved = await updatePost(deps, post.id, {
      title: "Sửa",
      slug: "hoc-aws",
      excerpt: "",
      content: "x",
      tags: [],
      coverImage: null,
      version: published.version,
    });
    expect(saved.version).toBe(published.version + 1);
    expect((await getPost(deps, post.id)).version).toBe(saved.version);
    expect(deps.builds.state.status).toBe("failed");
    expect(deps.log.errors).toHaveLength(1);
  });
});

describe("runScheduledPublish under a concurrent edit", () => {
  it("rethrows VERSION_CONFLICT (so the invocation is retried) and queues no build", async () => {
    const { deps, post } = await setup();
    await publishPost(deps, post.id, SCHEDULE);
    const realGet = deps.posts.get.bind(deps.posts);
    deps.posts.get = async (id) => {
      const snapshot = await realGet(id);
      const stored = deps.posts.items.get(id);
      if (stored) stored.version += 1; // an autosave lands between read and write
      return snapshot;
    };
    await expect(
      runScheduledPublish(deps, { postId: post.id, publishAt: "2026-10-12T08:00:00.000Z" }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(deps.buildQueue.reasons).toEqual([]);
  });
});
