import type { LangVersion, Post, PostSummary } from "@blog/shared";

export const makeVersion = (overrides: Partial<LangVersion> = {}): LangVersion => ({
  slug: "hoc-aws",
  title: "Học AWS",
  excerpt: "",
  content: "# Xin chào",
  status: "draft",
  publishAt: null,
  publishedAt: null,
  updatedAt: "2026-10-11T00:00:00.000Z",
  ...overrides,
});

export const makePost = (overrides: Partial<Post> = {}): Post => ({
  id: "01JTESTPOST",
  tags: [],
  coverImage: null,
  createdAt: "2026-10-11T00:00:00.000Z",
  updatedAt: "2026-10-11T00:00:00.000Z",
  version: 1,
  versions: { vi: makeVersion() },
  ...overrides,
});

export const summaryOf = (post: Post): PostSummary => ({
  ...post,
  versions: Object.fromEntries(
    Object.entries(post.versions).map(([lang, { content: _content, ...rest }]) => [lang, rest]),
  ),
});
