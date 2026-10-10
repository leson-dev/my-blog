import { z } from "zod";

export const LANGS = ["vi", "ja"] as const;
export type Lang = (typeof LANGS)[number];
export const langSchema = z.enum(LANGS);
export const otherLang = (lang: Lang): Lang => (lang === "vi" ? "ja" : "vi");

export const POST_STATUSES = ["draft", "scheduled", "published"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export interface LangVersion {
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  status: PostStatus;
  publishAt: string | null;
  publishedAt: string | null;
  updatedAt: string;
}

export type Versions = Partial<Record<Lang, LangVersion>>;

export interface Post {
  id: string;
  tags: string[];
  coverImage: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  versions: Versions;
}

export type LangVersionSummary = Omit<LangVersion, "content">;

export interface PostSummary extends Omit<Post, "versions"> {
  versions: Partial<Record<Lang, LangVersionSummary>>;
}

export const LIMITS = {
  titleMax: 200,
  excerptMax: 500,
  contentMaxBytes: 180_000,
  tagsMax: 20,
  tagMax: 30,
  slugMax: 100,
  tagNameMax: 50,
} as const;

const encoder = new TextEncoder();
export const utf8Bytes = (s: string): number => encoder.encode(s).length;

const titleSchema = z.string().trim().min(1).max(LIMITS.titleMax);
const slugInputSchema = z.string().max(LIMITS.slugMax);
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
const versionSchema = z.number().int().positive();

export const createPostInputSchema = z.object({
  lang: langSchema,
  title: titleSchema,
  slug: slugInputSchema.optional(),
  excerpt: excerptSchema.default(""),
  content: contentSchema.default(""),
  tags: tagsSchema.default([]),
  coverImage: coverImageSchema.default(null),
});
export type CreatePostInput = z.infer<typeof createPostInputSchema>;

/** Shared, language-independent fields. */
export const updatePostInputSchema = z.object({
  tags: tagsSchema,
  coverImage: coverImageSchema,
  version: versionSchema,
});
export type UpdatePostInput = z.infer<typeof updatePostInputSchema>;

/** Creates or edits one language version. */
export const upsertVersionInputSchema = z.object({
  title: titleSchema,
  slug: slugInputSchema.optional(),
  excerpt: excerptSchema,
  content: contentSchema,
  version: versionSchema,
});
export type UpsertVersionInput = z.infer<typeof upsertVersionInputSchema>;

export const publishInputSchema = z.object({
  publishAt: z.iso.datetime().optional(),
});
export type PublishInput = z.infer<typeof publishInputSchema>;
