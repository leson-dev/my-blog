import type { Post, PublishInput } from "@blog/shared";
import { publish } from "../domain/post";
import { requestBuild } from "./builds";
import type { Deps } from "./ports";
import { getPost } from "./posts";

export async function publishPost(deps: Deps, id: string, input: PublishInput): Promise<Post> {
  const prev = await getPost(deps, id);
  const next = publish(prev, input.publishAt, deps.now());
  await deps.posts.update(next, prev);
  if (next.status === "scheduled" && next.publishAt) {
    await deps.scheduler.schedule(id, next.publishAt);
  } else {
    await requestBuild(deps, `publish:${id}`);
  }
  return next;
}
