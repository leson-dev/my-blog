import type { Lang, Post, PublishInput } from "@blog/shared";
import { needsRebuild, publish, publishScheduled, unpublish } from "../domain/post";
import { afterCommit } from "./afterCommit";
import { requestBuild } from "./builds";
import type { Deps } from "./ports";
import { getPost } from "./posts";

export async function publishVersion(
  deps: Deps,
  id: string,
  lang: Lang,
  input: PublishInput,
): Promise<Post> {
  const prev = await getPost(deps, id);
  const next = publish(prev, lang, input.publishAt, deps.now());
  await deps.posts.update(next, prev);

  const version = next.versions[lang];
  if (version?.status === "scheduled" && version.publishAt) {
    try {
      await deps.scheduler.schedule(id, lang, version.publishAt);
    } catch (err) {
      // Do not leave a "scheduled" version without a schedule: restore the previous state.
      await deps.posts
        .update({ ...prev, updatedAt: deps.now(), version: next.version + 1 }, next)
        .catch((error) =>
          deps.log.error("revert after failed schedule failed", { error, postId: id, lang }),
        );
      throw err;
    }
    return next;
  }

  if (prev.versions[lang]?.status === "scheduled") {
    await afterCommit(deps, "schedule cancel", () => deps.scheduler.cancel(id, lang));
  }
  if (needsRebuild(prev, next)) {
    await afterCommit(deps, "build request", () => requestBuild(deps, `publish:${id}:${lang}`));
  }
  return next;
}

export async function unpublishVersion(deps: Deps, id: string, lang: Lang): Promise<Post> {
  const prev = await getPost(deps, id);
  const next = unpublish(prev, lang, deps.now());
  await deps.posts.update(next, prev);
  // If cancelling fails, the stale schedule is skipped by runScheduledPublish.
  if (prev.versions[lang]?.status === "scheduled") {
    await afterCommit(deps, "schedule cancel", () => deps.scheduler.cancel(id, lang));
  }
  if (needsRebuild(prev, next)) {
    await afterCommit(deps, "build request", () => requestBuild(deps, `unpublish:${id}:${lang}`));
  }
  return next;
}

/**
 * Called by EventBridge Scheduler (asynchronous Lambda invoke). Throwing hands the event to
 * Lambda's async retries, e.g. on VERSION_CONFLICT; stale events return "skipped".
 */
export async function runScheduledPublish(
  deps: Deps,
  event: { postId: string; lang: Lang; publishAt: string },
): Promise<"published" | "skipped"> {
  const prev = await deps.posts.get(event.postId);
  if (!prev) return "skipped";
  const next = publishScheduled(prev, event.lang, event.publishAt, deps.now());
  if (!next) return "skipped";
  await deps.posts.update(next, prev);
  await afterCommit(deps, "build request", () =>
    requestBuild(deps, `scheduled:${event.postId}:${event.lang}`),
  );
  return "published";
}
