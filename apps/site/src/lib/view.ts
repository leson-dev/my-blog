import { type Lang, type LangVersion, otherLang, type Post, type Tag } from "@blog/shared";
import { urls } from "./urls";

export interface PostPage {
  post: Post;
  /** Language of the page chrome. */
  ui: Lang;
  /** Language of the version shown (differs from `ui` when only the other one is published). */
  lang: Lang;
  version: LangVersion;
  url: string;
  /** The same post's page under the other UI language. */
  altUrl: string;
  /** The other published version, only when both are published. */
  translationUrl: string | null;
}

const published = (post: Post, lang: Lang): LangVersion | undefined => {
  const version = post.versions[lang];
  return version?.status === "published" ? version : undefined;
};

export function postPage(post: Post, ui: Lang): PostPage | null {
  const alt = otherLang(ui);
  const own = published(post, ui);
  const other = published(post, alt);
  const version = own ?? other;
  if (!version) return null;
  const altVersion = other ?? version;
  return {
    post,
    ui,
    lang: own ? ui : alt,
    version,
    url: urls.post(ui, version.slug),
    altUrl: urls.post(alt, altVersion.slug),
    translationUrl: own && other ? urls.post(alt, other.slug) : null,
  };
}

export function postPages(posts: Post[], ui: Lang): PostPage[] {
  return posts
    .flatMap((post) => {
      const page = postPage(post, ui);
      return page ? [page] : [];
    })
    .sort((a, b) => (b.version.publishedAt ?? "").localeCompare(a.version.publishedAt ?? ""));
}

export interface YearGroup {
  year: string;
  pages: PostPage[];
}

/** Expects pages sorted newest first; groups by the UTC year of publishedAt. */
export function byYear(pages: PostPage[]): YearGroup[] {
  const groups: YearGroup[] = [];
  for (const page of pages) {
    const year = (page.version.publishedAt ?? "").slice(0, 4);
    const last = groups.at(-1);
    if (last && last.year === year) last.pages.push(page);
    else groups.push({ year, pages: [page] });
  }
  return groups;
}

export function tagName(tags: Tag[], key: string, ui: Lang): string {
  return tags.find((tag) => tag.key === key)?.names[ui] ?? key;
}

export interface TagEntry {
  key: string;
  name: string;
  count: number;
  url: string;
}

export function tagEntries(pages: PostPage[], tags: Tag[], ui: Lang): TagEntry[] {
  const counts = new Map<string, number>();
  for (const page of pages) {
    for (const key of page.post.tags) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .map(([key, count]) => ({ key, name: tagName(tags, key, ui), count, url: urls.tag(ui, key) }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export const pagesWithTag = (pages: PostPage[], key: string): PostPage[] =>
  pages.filter((page) => page.post.tags.includes(key));
