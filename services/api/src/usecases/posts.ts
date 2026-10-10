import type { CreatePostInput, Post, PostSummary, UpdatePostInput } from "@blog/shared";
import { DomainError, notFound } from "../domain/errors";
import { applyUpdate, needsRebuild, newPost, toSummary } from "../domain/post";
import { afterCommit } from "./afterCommit";
import { requestBuild } from "./builds";
import type { Deps } from "./ports";

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

export interface Caller {
  /** The e2e test account may only touch drafts, never content that is live or about to be. */
  e2e: boolean;
}

function assertCallerMayModify(post: Post, caller: Caller) {
  if (caller.e2e && post.status !== "draft") {
    throw new DomainError("FORBIDDEN", "the e2e account can only modify drafts");
  }
}

export async function updatePost(
  deps: Deps,
  id: string,
  input: UpdatePostInput,
  caller: Caller = { e2e: false },
): Promise<Post> {
  const prev = await getPost(deps, id);
  assertCallerMayModify(prev, caller);
  const next = applyUpdate(prev, input, deps.now());
  await deps.posts.update(next, prev);
  if (needsRebuild(prev, next)) {
    await afterCommit(deps, "build request", () => requestBuild(deps, `update:${id}`));
  }
  return next;
}

export async function deletePost(
  deps: Deps,
  id: string,
  caller: Caller = { e2e: false },
): Promise<void> {
  const prev = await getPost(deps, id);
  assertCallerMayModify(prev, caller);
  // Delete first: if cancelling then fails, the orphan schedule finds no post and is skipped.
  await deps.posts.delete(prev);
  if (prev.status === "scheduled") {
    await afterCommit(deps, "schedule cancel", () => deps.scheduler.cancel(id));
  }
  if (needsRebuild(prev, null)) {
    await afterCommit(deps, "build request", () => requestBuild(deps, `delete:${id}`));
  }
}
