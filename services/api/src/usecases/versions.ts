import type { Lang, Post, UpsertVersionInput } from "@blog/shared";
import { applyVersion, needsRebuild, withoutVersion } from "../domain/post";
import { afterCommit } from "./afterCommit";
import { requestBuild } from "./builds";
import type { Deps } from "./ports";
import { AUTHOR, assertCallerMayModify, type Caller, getPost } from "./posts";

export async function upsertVersion(
  deps: Deps,
  id: string,
  lang: Lang,
  input: UpsertVersionInput,
  caller: Caller = AUTHOR,
): Promise<Post> {
  const prev = await getPost(deps, id);
  assertCallerMayModify(prev, caller);
  const next = applyVersion(prev, lang, input, deps.now());
  await deps.posts.update(next, prev);
  if (needsRebuild(prev, next)) {
    await afterCommit(deps, "build request", () => requestBuild(deps, `update:${id}:${lang}`));
  }
  return next;
}

export async function deleteVersion(
  deps: Deps,
  id: string,
  lang: Lang,
  caller: Caller = AUTHOR,
): Promise<Post> {
  const prev = await getPost(deps, id);
  assertCallerMayModify(prev, caller);
  const next = withoutVersion(prev, lang, deps.now());
  await deps.posts.update(next, prev);
  if (prev.versions[lang]?.status === "scheduled") {
    await afterCommit(deps, "schedule cancel", () => deps.scheduler.cancel(id, lang));
  }
  if (needsRebuild(prev, next)) {
    await afterCommit(deps, "build request", () => requestBuild(deps, `delete:${id}:${lang}`));
  }
  return next;
}
