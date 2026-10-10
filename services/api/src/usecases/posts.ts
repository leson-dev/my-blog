import type { CreatePostInput, Post, PostSummary, UpdatePostInput } from "@blog/shared";
import { DomainError, notFound } from "../domain/errors";
import {
  isLive,
  needsRebuild,
  newPost,
  scheduledLangs,
  toSummary,
  updateShared,
} from "../domain/post";
import { afterCommit } from "./afterCommit";
import { requestBuild } from "./builds";
import type { Deps } from "./ports";

export interface Caller {
  /** The e2e test account may only touch posts with nothing published or scheduled. */
  e2e: boolean;
}

export const AUTHOR: Caller = { e2e: false };

export function assertCallerMayModify(post: Post, caller: Caller) {
  if (caller.e2e && isLive(post)) {
    throw new DomainError(
      "FORBIDDEN",
      "the e2e account can only modify posts with nothing published or scheduled",
    );
  }
}

export async function listPosts(deps: Deps): Promise<PostSummary[]> {
  return (await deps.posts.list()).map(toSummary);
}

export async function getPost(deps: Deps, id: string): Promise<Post> {
  const post = await deps.posts.get(id);
  if (!post) throw notFound("post");
  return post;
}

export async function createPost(deps: Deps, input: CreatePostInput): Promise<Post> {
  const post = newPost(input, { id: deps.newId(), now: deps.now() });
  await deps.posts.create(post);
  return post;
}

export async function updatePost(
  deps: Deps,
  id: string,
  input: UpdatePostInput,
  caller: Caller = AUTHOR,
): Promise<Post> {
  const prev = await getPost(deps, id);
  assertCallerMayModify(prev, caller);
  const next = updateShared(prev, input, deps.now());
  await deps.posts.update(next, prev);
  if (needsRebuild(prev, next)) {
    await afterCommit(deps, "build request", () => requestBuild(deps, `update:${id}`));
  }
  return next;
}

export async function deletePost(deps: Deps, id: string, caller: Caller = AUTHOR): Promise<void> {
  const prev = await getPost(deps, id);
  assertCallerMayModify(prev, caller);
  // Delete first: if cancelling then fails, the orphan schedule finds no post and is skipped.
  await deps.posts.delete(prev);
  for (const lang of scheduledLangs(prev)) {
    await afterCommit(deps, "schedule cancel", () => deps.scheduler.cancel(id, lang));
  }
  if (needsRebuild(prev, null)) {
    await afterCommit(deps, "build request", () => requestBuild(deps, `delete:${id}`));
  }
}
