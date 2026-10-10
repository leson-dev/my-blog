import type { Lang, Post, PublishInput } from "@blog/shared";
import { needsRebuild, publish } from "../domain/post";
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
    await deps.scheduler.schedule(id, lang, version.publishAt);
  } else if (needsRebuild(prev, next)) {
    await afterCommit(deps, "build request", () => requestBuild(deps, `publish:${id}:${lang}`));
  }
  return next;
}
