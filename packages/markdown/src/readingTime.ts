import type { Lang } from "@blog/shared";

const WORDS_PER_MINUTE = 200;
const JA_CHARS_PER_MINUTE = 500;

export function readingMinutes(markdown: string, lang: Lang): number {
  const text = markdown.replace(/```[\s\S]*?```/g, " ");
  const minutes =
    lang === "ja"
      ? text.replace(/\s/g, "").length / JA_CHARS_PER_MINUTE
      : text.split(/\s+/).filter(Boolean).length / WORDS_PER_MINUTE;
  return Math.max(1, Math.round(minutes));
}
