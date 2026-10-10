import type { Post } from "@blog/shared";

export const POSTS_INDEX = "byUpdated";
export const postKey = (id: string) => ({ PK: `POST#${id}`, SK: "POST" });
export const slugKey = (slug: string) => ({ PK: `SLUG#${slug}`, SK: "SLUG" });
export const BUILD_KEY = { PK: "BUILD", SK: "LATEST" } as const;

export function toPostItem(post: Post): Record<string, unknown> {
  return { ...postKey(post.id), GSI1PK: "POST", GSI1SK: post.updatedAt, ...post };
}

export function fromPostItem(item: Record<string, unknown>): Post {
  const { PK: _pk, SK: _sk, GSI1PK: _gpk, GSI1SK: _gsk, ...post } = item;
  return post as unknown as Post;
}
