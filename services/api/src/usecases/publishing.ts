import type { Post, PublishInput } from "@blog/shared";
import { needsRebuild, publish, publishScheduled, unpublish } from "../domain/post";
import { requestBuild } from "./builds";
import type { Deps } from "./ports";
import { getPost } from "./posts";

export async function publishPost(deps: Deps, id: string, input: PublishInput): Promise<Post> {
  const prev = await getPost(deps, id);
  const next = publish(prev, input.publishAt, deps.now());
  await deps.posts.update(next, prev);

  if (next.status === "scheduled" && next.publishAt) {
    try {
      await deps.scheduler.schedule(id, next.publishAt);
    } catch (err) {
      // Do not leave a "scheduled" post without a schedule: restore the previous state.
      await deps.posts
        .update({ ...prev, updatedAt: deps.now(), version: next.version + 1 }, next)
        .catch(() => undefined);
      throw err;
    }
    return next;
  }

  if (prev.status === "scheduled") await deps.scheduler.cancel(id);
  await requestBuild(deps, `publish:${id}`);
  return next;
}

export async function unpublishPost(deps: Deps, id: string): Promise<Post> {
  const prev = await getPost(deps, id);
  const next = unpublish(prev, deps.now());
  await deps.posts.update(next, prev);
  // If cancelling fails, the stale schedule is skipped by runScheduledPublish.
  if (prev.status === "scheduled") await deps.scheduler.cancel(id);
  if (needsRebuild(prev, next)) await requestBuild(deps, `unpublish:${id}`);
  return next;
}

/** Called by EventBridge Scheduler. Throwing makes Scheduler retry (e.g. on VERSION_CONFLICT). */
export async function runScheduledPublish(
  deps: Deps,
  event: { postId: string; publishAt: string },
): Promise<"published" | "skipped"> {
  const prev = await deps.posts.get(event.postId);
  if (!prev) return "skipped";
  const next = publishScheduled(prev, event.publishAt, deps.now());
  if (!next) return "skipped";
  await deps.posts.update(next, prev);
  await requestBuild(deps, `scheduled:${event.postId}`);
  return "published";
}
