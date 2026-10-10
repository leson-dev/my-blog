import type { Lang } from "@blog/shared";

export const urls = {
  home: (ui: Lang) => `/${ui}/`,
  post: (ui: Lang, slug: string) => `/${ui}/posts/${slug}/`,
  tags: (ui: Lang) => `/${ui}/tags/`,
  tag: (ui: Lang, key: string) => `/${ui}/tags/${key}/`,
  search: (ui: Lang) => `/${ui}/search/`,
};
