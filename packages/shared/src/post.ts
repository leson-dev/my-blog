import { z } from "zod";

export const POST_STATUSES = ["draft", "scheduled", "published"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export interface Post {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  tags: string[];
  coverImage: string | null;
  status: PostStatus;
  publishAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export type PostSummary = Omit<Post, "content">;

export const LIMITS = {
  titleMax: 200,
  excerptMax: 500,
  contentMaxBytes: 300_000,
  tagsMax: 20,
  tagMax: 30,
  slugMax: 100,
} as const;

const encoder = new TextEncoder();
export const utf8Bytes = (s: string): number => encoder.encode(s).length;

const titleSchema = z.string().trim().min(1).max(LIMITS.titleMax);
const excerptSchema = z.string().max(LIMITS.excerptMax);
const contentSchema = z.string().refine((s) => utf8Bytes(s) <= LIMITS.contentMaxBytes, {
  message: `content must be at most ${LIMITS.contentMaxBytes} bytes`,
});
const tagsSchema = z.array(z.string().max(LIMITS.tagMax)).max(LIMITS.tagsMax);
const coverImageSchema = z
  .string()
  .max(500)
  .regex(/^(\/media\/|https:\/\/)/, "cover image must be a /media/ path or an https URL")
  .nullable();

export const createPostInputSchema = z.object({
  title: titleSchema,
  slug: z.string().max(LIMITS.slugMax).optional(),
  excerpt: excerptSchema.default(""),
  content: contentSchema.default(""),
  tags: tagsSchema.default([]),
  coverImage: coverImageSchema.default(null),
});
export type CreatePostInput = z.infer<typeof createPostInputSchema>;

export const updatePostInputSchema = z.object({
  title: titleSchema,
  slug: z.string().min(1).max(LIMITS.slugMax),
  excerpt: excerptSchema,
  content: contentSchema,
  tags: tagsSchema,
  coverImage: coverImageSchema,
  version: z.number().int().positive(),
});
export type UpdatePostInput = z.infer<typeof updatePostInputSchema>;

export const publishInputSchema = z.object({
  publishAt: z.iso.datetime().optional(),
});
export type PublishInput = z.infer<typeof publishInputSchema>;
