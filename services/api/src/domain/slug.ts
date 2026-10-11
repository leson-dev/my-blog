import { slugify } from "@blog/shared";
import { DomainError } from "./errors";

export { isValidSlug, slugify } from "@blog/shared";

export function normalizeTags(tags: string[]): string[] {
  const result: string[] = [];
  for (const raw of tags) {
    const tag = slugify(raw);
    if (tag === "") {
      throw new DomainError(
        "VALIDATION_ERROR",
        `tag "${raw}" must contain at least one latin letter or digit`,
      );
    }
    if (!result.includes(tag)) result.push(tag);
  }
  return result;
}
