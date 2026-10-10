import type { CreatePostInput, Post, PostSummary, UpdatePostInput } from "@blog/shared";
import { notFound } from "../domain/errors";
import { applyUpdate, needsRebuild, newPost, toSummary } from "../domain/post";
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

export async function updatePost(deps: Deps, id: string, input: UpdatePostInput): Promise<Post> {
  const prev = await getPost(deps, id);
  const next = applyUpdate(prev, input, deps.now());
  await deps.posts.update(next, prev);
  if (needsRebuild(prev, next)) await requestBuild(deps, `update:${id}`);
  return next;
}

export async function deletePost(deps: Deps, id: string): Promise<void> {
  const prev = await getPost(deps, id);
  // Delete first: if cancelling then fails, the orphan schedule finds no post and is skipped.
  await deps.posts.delete(prev);
  if (prev.status === "scheduled") await deps.scheduler.cancel(id);
  if (needsRebuild(prev, null)) await requestBuild(deps, `delete:${id}`);
}
