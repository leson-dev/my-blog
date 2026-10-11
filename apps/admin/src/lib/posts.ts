import { LANGS, type Lang, type Post, type PostStatus, type PostSummary } from "@blog/shared";

export const STATUS_LABEL: Record<PostStatus, string> = {
  draft: "nháp",
  scheduled: "hẹn giờ",
  published: "đã đăng",
};

export const UNTITLED = "(không tiêu đề)";

type WithVersions = Pick<PostSummary, "versions">;

export function displayTitle(post: WithVersions): string {
  return post.versions.vi?.title ?? post.versions.ja?.title ?? UNTITLED;
}

export type StatusFilter = "all" | PostStatus;

/** Lowercase, without Vietnamese accents, so "hoc aws" finds "Học AWS". */
const fold = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").replace(/[đĐ]/g, "d").toLowerCase();

export function filterPosts(
  posts: PostSummary[],
  filter: { status: StatusFilter; query: string },
): PostSummary[] {
  const query = fold(filter.query.trim());
  return posts
    .filter(
      (p) => filter.status === "all" || LANGS.some((l) => p.versions[l]?.status === filter.status),
    )
    .filter(
      (p) =>
        query === "" ||
        LANGS.some((l) => {
          const title = p.versions[l]?.title;
          return title !== undefined && fold(title).includes(query);
        }),
    )
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function versionBadges(
  post: WithVersions,
): Array<{ lang: Lang; status: PostStatus | null; text: string }> {
  return LANGS.map((lang) => {
    const status = post.versions[lang]?.status ?? null;
    return { lang, status, text: `${lang}: ${status ? STATUS_LABEL[status] : "—"}` };
  });
}

/** The editor tab to open: the requested one if that version exists, else vi, else ja. */
export function pickLang(post: Pick<Post, "versions">, requested: string | null): Lang | null {
  const wanted = LANGS.find((l) => l === requested);
  if (wanted && post.versions[wanted]) return wanted;
  return LANGS.find((l) => post.versions[l]) ?? null;
}
