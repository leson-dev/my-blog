import type { Post, Tag } from "@blog/shared";

export const POSTS_INDEX = "byUpdated";
export const postKey = (id: string) => ({ PK: `POST#${id}`, SK: "POST" });
export const slugKey = (slug: string) => ({ PK: `SLUG#${slug}`, SK: "SLUG" });
export const tagKey = (key: string) => ({ PK: `TAG#${key}`, SK: "TAG" });
export const BUILD_KEY = { PK: "BUILD", SK: "LATEST" } as const;

export function toPostItem(post: Post): Record<string, unknown> {
  return { ...postKey(post.id), GSI1PK: "POST", GSI1SK: post.updatedAt, ...post };
}

export function fromPostItem(item: Record<string, unknown>): Post {
  const { PK: _pk, SK: _sk, GSI1PK: _gpk, GSI1SK: _gsk, ...post } = item;
  return post as unknown as Post;
}

export function toTagItem(tag: Tag): Record<string, unknown> {
  return { ...tagKey(tag.key), GSI1PK: "TAG", GSI1SK: tag.key, key: tag.key, names: tag.names };
}

export function fromTagItem(item: Record<string, unknown>): Tag {
  return { key: item.key as string, names: (item.names as Tag["names"] | undefined) ?? {} };
}
