import type { LangVersion, Post } from "@blog/shared";

export const sampleVersion = (overrides: Partial<LangVersion> = {}): LangVersion => ({
  slug: "hoc-aws",
  title: "Học AWS",
  excerpt: "",
  content: "# Hi",
  status: "draft",
  publishAt: null,
  publishedAt: null,
  updatedAt: "2026-10-10T00:00:00.000Z",
  ...overrides,
});

export const samplePost = (overrides: Partial<Post> = {}): Post => ({
  id: "01JABCDEFGHJKMNPQRSTVWXYZ0",
  tags: ["aws"],
  coverImage: null,
  createdAt: "2026-10-10T00:00:00.000Z",
  updatedAt: "2026-10-10T00:00:00.000Z",
  version: 1,
  versions: { vi: sampleVersion() },
  ...overrides,
});
