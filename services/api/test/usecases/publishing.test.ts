import { describe, expect, it } from "vitest";
import { createPost, getPost } from "../../src/usecases/posts";
import {
  publishVersion,
  runScheduledPublish,
  unpublishVersion,
} from "../../src/usecases/publishing";
import { deleteVersion, upsertVersion } from "../../src/usecases/versions";
import { makeDeps } from "../fakes";

const FUTURE = { publishAt: "2026-10-12T08:00:00Z" };
const AT = "2026-10-12T08:00:00.000Z";

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

describe("publishVersion", () => {
  it("publishes vi now and builds", async () => {
    const { deps, post } = await setup();
    const next = await publishVersion(deps, post.id, "vi", {});
    expect(next.versions.vi?.status).toBe("published");
    expect(deps.buildQueue.reasons).toEqual([`publish:${post.id}:vi`]);
  });

  it("schedules one language without building", async () => {
    const { deps, post } = await setup();
    await publishVersion(deps, post.id, "vi", FUTURE);
    expect(deps.scheduler.scheduled.get(`${post.id}:vi`)).toBe(AT);
    expect(deps.buildQueue.reasons).toEqual([]);
  });

  it("cancels the schedule and builds when a scheduled version is published now", async () => {
    const { deps, post } = await setup();
    await publishVersion(deps, post.id, "vi", FUTURE);
    await publishVersion(deps, post.id, "vi", {});
    expect(deps.scheduler.cancelled).toEqual([`${post.id}:vi`]);
    expect(deps.buildQueue.reasons).toEqual([`publish:${post.id}:vi`]);
  });

  it("still builds when cancelling the old schedule fails", async () => {
    const { deps, post } = await setup();
    await publishVersion(deps, post.id, "vi", FUTURE);
    deps.scheduler.cancelFailWith = new Error("throttled");
    await publishVersion(deps, post.id, "vi", {});
    expect(deps.buildQueue.reasons).toEqual([`publish:${post.id}:vi`]);
    expect(deps.log.errors).toHaveLength(1);
  });

  it("reverts the post when the schedule cannot be created", async () => {
    const { deps, post } = await setup();
    deps.scheduler.failWith = new Error("Scheduler down");
    await expect(publishVersion(deps, post.id, "vi", FUTURE)).rejects.toThrow("Scheduler down");
    expect((await getPost(deps, post.id)).versions.vi?.status).toBe("draft");
  });

  it("logs when the revert itself fails", async () => {
    const { deps, post } = await setup();
    deps.scheduler.failWith = new Error("Scheduler down");
    const realUpdate = deps.posts.update.bind(deps.posts);
    let calls = 0;
    deps.posts.update = async (next, prev) => {
      calls += 1;
      if (calls === 2) throw new Error("DynamoDB down");
      return realUpdate(next, prev);
    };
    await expect(publishVersion(deps, post.id, "vi", FUTURE)).rejects.toThrow("Scheduler down");
    expect(deps.log.errors).toHaveLength(1);
  });
});

describe("unpublishVersion", () => {
  it("takes a published version down and builds", async () => {
    const { deps, post } = await setup();
    await publishVersion(deps, post.id, "vi", {});
    deps.buildQueue.reasons.length = 0;
    expect((await unpublishVersion(deps, post.id, "vi")).versions.vi?.status).toBe("draft");
    expect(deps.buildQueue.reasons).toEqual([`unpublish:${post.id}:vi`]);
  });

  it("cancels a schedule without building, even if cancelling fails", async () => {
    const { deps, post } = await setup();
    await publishVersion(deps, post.id, "vi", FUTURE);
    deps.scheduler.cancelFailWith = new Error("throttled");
    expect((await unpublishVersion(deps, post.id, "vi")).versions.vi?.status).toBe("draft");
    expect(deps.buildQueue.reasons).toEqual([]);
    expect(deps.log.errors).toHaveLength(1);
  });
});

describe("runScheduledPublish", () => {
  it("publishes the matching language and builds", async () => {
    const { deps, post } = await setup();
    const withJa = await upsertVersion(deps, post.id, "ja", {
      title: "AWS",
      excerpt: "",
      content: "",
      version: 1,
    });
    expect(withJa.versions.ja).toBeDefined();
    await publishVersion(deps, post.id, "ja", FUTURE);
    const result = await runScheduledPublish(deps, { postId: post.id, lang: "ja", publishAt: AT });
    expect(result).toBe("published");
    const stored = await getPost(deps, post.id);
    expect(stored.versions.ja?.status).toBe("published");
    expect(stored.versions.vi?.status).toBe("draft");
    expect(deps.buildQueue.reasons).toEqual([`scheduled:${post.id}:ja`]);
  });

  it("skips an event for the other language", async () => {
    const { deps, post } = await setup();
    await publishVersion(deps, post.id, "vi", FUTURE);
    expect(await runScheduledPublish(deps, { postId: post.id, lang: "ja", publishAt: AT })).toBe(
      "skipped",
    );
  });

  it("skips a stale event after rescheduling", async () => {
    const { deps, post } = await setup();
    await publishVersion(deps, post.id, "vi", FUTURE);
    await publishVersion(deps, post.id, "vi", { publishAt: "2026-10-13T08:00:00Z" });
    expect(await runScheduledPublish(deps, { postId: post.id, lang: "vi", publishAt: AT })).toBe(
      "skipped",
    );
    expect(deps.buildQueue.reasons).toEqual([]);
  });

  it("skips when the version or the post is gone", async () => {
    const { deps, post } = await setup();
    const withJa = await upsertVersion(deps, post.id, "ja", {
      title: "AWS",
      excerpt: "",
      content: "",
      version: 1,
    });
    expect(withJa.versions.ja).toBeDefined();
    await publishVersion(deps, post.id, "ja", FUTURE);
    await deleteVersion(deps, post.id, "ja");
    expect(await runScheduledPublish(deps, { postId: post.id, lang: "ja", publishAt: AT })).toBe(
      "skipped",
    );
    expect(await runScheduledPublish(deps, { postId: "gone", lang: "vi", publishAt: AT })).toBe(
      "skipped",
    );
  });

  it("rethrows VERSION_CONFLICT so the invocation is retried, without building", async () => {
    const { deps, post } = await setup();
    await publishVersion(deps, post.id, "vi", FUTURE);
    const realGet = deps.posts.get.bind(deps.posts);
    deps.posts.get = async (id) => {
      const snapshot = await realGet(id);
      const stored = deps.posts.items.get(id);
      if (stored) stored.version += 1; // an autosave lands between read and write
      return snapshot;
    };
    await expect(
      runScheduledPublish(deps, { postId: post.id, lang: "vi", publishAt: AT }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(deps.buildQueue.reasons).toEqual([]);
  });
});
