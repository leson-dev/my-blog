import { z } from "zod";
import { type Lang, LIMITS } from "./post";

export interface Tag {
  /** URL-safe key, e.g. "life". */
  key: string;
  names: Partial<Record<Lang, string>>;
}

export interface TagSummary extends Tag {
  postCount: number;
}

const tagNameSchema = z.string().trim().min(1).max(LIMITS.tagNameMax);

export const putTagInputSchema = z.object({
  names: z.object({ vi: tagNameSchema.optional(), ja: tagNameSchema.optional() }),
});
export type PutTagInput = z.infer<typeof putTagInputSchema>;
