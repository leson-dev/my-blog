import { LIMITS } from "./post";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugify(input: string): string {
  const base = input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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
