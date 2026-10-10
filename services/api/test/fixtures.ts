import type { Post } from "@blog/shared";

export const samplePost = (overrides: Partial<Post> = {}): Post => ({
  id: "01JABCDEFGHJKMNPQRSTVWXYZ0",
  slug: "hoc-aws",
  title: "Học AWS",
  excerpt: "",
  content: "# Hi",
  tags: ["aws"],
  coverImage: null,
  status: "draft",
  publishAt: null,
  publishedAt: null,
  createdAt: "2026-10-10T00:00:00.000Z",
  updatedAt: "2026-10-10T00:00:00.000Z",
  version: 1,
  ...overrides,
});
