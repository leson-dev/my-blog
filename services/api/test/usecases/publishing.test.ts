import { describe, expect, it } from "vitest";
import { createPost, getPost } from "../../src/usecases/posts";
import { publishPost, runScheduledPublish, unpublishPost } from "../../src/usecases/publishing";
import { makeDeps } from "../fakes";

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

describe("publishPost", () => {
  it("publishes now and requests a build", async () => {
    const { deps, post } = await setup();
    const next = await publishPost(deps, post.id, {});
    expect(next.status).toBe("published");
    expect(deps.buildQueue.reasons).toEqual([`publish:${post.id}`]);
    expect(deps.scheduler.scheduled.size).toBe(0);
  });

  it("schedules a future post without building", async () => {
    const { deps, post } = await setup();
    const next = await publishPost(deps, post.id, { publishAt: "2026-10-12T08:00:00Z" });
    expect(next.status).toBe("scheduled");
    expect(deps.scheduler.scheduled.get(post.id)).toBe("2026-10-12T08:00:00.000Z");
    expect(deps.buildQueue.reasons).toEqual([]);
  });

  it("cancels the schedule when a scheduled post is published now", async () => {
    const { deps, post } = await setup();
    await publishPost(deps, post.id, { publishAt: "2026-10-12T08:00:00Z" });
    await publishPost(deps, post.id, {});
    expect(deps.scheduler.cancelled).toEqual([post.id]);
    expect(deps.buildQueue.reasons).toEqual([`publish:${post.id}`]);
  });

  it("reverts the post when the schedule cannot be created", async () => {
    const { deps, post } = await setup();
    deps.scheduler.failWith = new Error("Scheduler down");
    await expect(publishPost(deps, post.id, { publishAt: "2026-10-12T08:00:00Z" })).rejects.toThrow(
      "Scheduler down",
    );
    const stored = await getPost(deps, post.id);
    expect(stored.status).toBe("draft");
    expect(stored.publishAt).toBeNull();
  });
});

describe("unpublishPost", () => {
  it("takes a published post down and requests a build", async () => {
    const { deps, post } = await setup();
    await publishPost(deps, post.id, {});
    deps.buildQueue.reasons.length = 0;
    const next = await unpublishPost(deps, post.id);
    expect(next.status).toBe("draft");
    expect(deps.buildQueue.reasons).toEqual([`unpublish:${post.id}`]);
  });

  it("cancels a schedule without building", async () => {
    const { deps, post } = await setup();
    await publishPost(deps, post.id, { publishAt: "2026-10-12T08:00:00Z" });
    await unpublishPost(deps, post.id);
    expect(deps.scheduler.cancelled).toEqual([post.id]);
    expect(deps.buildQueue.reasons).toEqual([]);
  });
});

describe("runScheduledPublish", () => {
  it("publishes when the event matches and requests a build", async () => {
    const { deps, post } = await setup();
    await publishPost(deps, post.id, { publishAt: "2026-10-12T08:00:00Z" });
    deps.clock.now = "2026-10-12T08:00:01.000Z";
    const result = await runScheduledPublish(deps, {
      postId: post.id,
      publishAt: "2026-10-12T08:00:00.000Z",
    });
    expect(result).toBe("published");
    expect((await getPost(deps, post.id)).status).toBe("published");
    expect(deps.buildQueue.reasons).toEqual([`scheduled:${post.id}`]);
  });

  it("skips a stale event after the post was rescheduled", async () => {
    const { deps, post } = await setup();
    await publishPost(deps, post.id, { publishAt: "2026-10-12T08:00:00Z" });
    await publishPost(deps, post.id, { publishAt: "2026-10-13T08:00:00Z" });
    const result = await runScheduledPublish(deps, {
      postId: post.id,
      publishAt: "2026-10-12T08:00:00.000Z",
    });
    expect(result).toBe("skipped");
    expect(deps.buildQueue.reasons).toEqual([]);
  });

  it("skips when the post was deleted", async () => {
    const deps = makeDeps();
    const result = await runScheduledPublish(deps, {
      postId: "gone",
      publishAt: "2026-10-12T08:00:00.000Z",
    });
    expect(result).toBe("skipped");
  });
});
