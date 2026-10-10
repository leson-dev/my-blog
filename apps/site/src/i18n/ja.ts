import type { Lang } from "@blog/shared";
import type { Dict } from "./vi";

export const ja: Dict = {
  siteName: "oki-dev",
  "nav.posts": "記事",
  "nav.tags": "タグ",
  "nav.search": "検索",
  langName: "日本語",
  "archive.empty": "まだ記事がありません。",
  "post.minutes": (n: number) => `${n}分で読めます`,
  "post.onlyIn": (lang: Lang) =>
    lang === "vi" ? "この記事はベトナム語のみです。" : "この記事は日本語のみです。",
  "post.readIn": "言語",
  "tags.title": "タグ",
  "tags.count": (n: number) => `${n}件`,
  "search.title": "検索",
};
