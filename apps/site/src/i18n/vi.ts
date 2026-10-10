import type { Lang } from "@blog/shared";

export const vi = {
  siteName: "oki-dev",
  "nav.posts": "bài viết",
  "nav.tags": "tag",
  "nav.search": "tìm kiếm",
  langName: "Tiếng Việt",
  "archive.empty": "Chưa có bài viết nào.",
  "post.minutes": (n: number): string => `${n} phút đọc`,
  "post.onlyIn": (lang: Lang): string =>
    lang === "ja" ? "Bài này chỉ có bản tiếng Nhật." : "Bài này chỉ có bản tiếng Việt.",
  "post.readIn": "Đọc bằng",
  "tags.title": "Tag",
  "tags.count": (n: number): string => `${n} bài`,
  "search.title": "Tìm kiếm",
};

export type Dict = typeof vi;
