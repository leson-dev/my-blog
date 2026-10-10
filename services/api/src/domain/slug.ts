import { LIMITS } from "@blog/shared";
import { DomainError } from "./errors";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugify(input: string): string {
  const base = input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base.length <= LIMITS.slugMax) return base;

  const cut = base.slice(0, LIMITS.slugMax);
  if (base[LIMITS.slugMax] === "-") return cut;
  const lastDash = cut.lastIndexOf("-");
  return lastDash > 0 ? cut.slice(0, lastDash) : cut;
}

export function isValidSlug(s: string): boolean {
  return s.length <= LIMITS.slugMax && SLUG_PATTERN.test(s);
}

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
