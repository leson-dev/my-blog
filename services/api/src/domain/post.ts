import {
  type CreatePostInput,
  LANGS,
  type Lang,
  type LangVersion,
  type Post,
  type PostStatus,
  type PostSummary,
  type UpdatePostInput,
  type UpsertVersionInput,
  type Versions,
} from "@blog/shared";
import { DomainError } from "./errors";
import { isValidSlug, normalizeTags, slugify } from "./slug";

/** Schedules closer than this are published immediately instead. */
export const SCHEDULE_MIN_LEAD_MS = 60_000;

function resolveSlug(requested: string, title: string, id: string, lang: Lang): string {
  if (requested.trim() !== "") {
    const slug = slugify(requested);
    if (!isValidSlug(slug)) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "slug must contain at least one latin letter or digit",
      );
    }
    return slug;
  }
  const fromTitle = slugify(title);
  return fromTitle !== "" ? fromTitle : `${id.toLowerCase()}-${lang}`;
}

function truncateToSecond(iso: string): string {
  const ms = Date.parse(iso);
  return new Date(ms - (ms % 1000)).toISOString();
}

function assertVersion(post: Post, expected: number) {
  if (expected !== post.version) {
    throw new DomainError(
      "VERSION_CONFLICT",
      `post was modified elsewhere (current version ${post.version})`,
    );
  }
}

export function getVersion(post: Post, lang: Lang): LangVersion {
  const version = post.versions[lang];
  if (!version) throw new DomainError("NOT_FOUND", `${lang} version not found`);
  return version;
}

function withVersion(post: Post, lang: Lang, version: LangVersion | undefined, now: string): Post {
  const versions: Versions = { ...post.versions };
  if (version) versions[lang] = version;
  else delete versions[lang];
  return { ...post, versions, updatedAt: now, version: post.version + 1 };
}

export function newPost(input: CreatePostInput, ctx: { id: string; now: string }): Post {
  const versions: Versions = {};
  versions[input.lang] = {
    slug: resolveSlug(input.slug ?? "", input.title, ctx.id, input.lang),
    title: input.title,
    excerpt: input.excerpt,
    content: input.content,
    status: "draft",
    publishAt: null,
    publishedAt: null,
    updatedAt: ctx.now,
  };
  return {
    id: ctx.id,
    tags: normalizeTags(input.tags),
    coverImage: input.coverImage,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    version: 1,
    versions,
  };
}

export function updateShared(post: Post, input: UpdatePostInput, now: string): Post {
  assertVersion(post, input.version);
  return {
    ...post,
    tags: normalizeTags(input.tags),
    coverImage: input.coverImage,
    updatedAt: now,
    version: post.version + 1,
  };
}

export function applyVersion(post: Post, lang: Lang, input: UpsertVersionInput, now: string): Post {
  assertVersion(post, input.version);
  const existing = post.versions[lang];
  const requested = input.slug ?? "";
  const slug =
    requested.trim() !== ""
      ? resolveSlug(requested, input.title, post.id, lang)
      : (existing?.slug ?? resolveSlug("", input.title, post.id, lang));
  const fields = {
    slug,
    title: input.title,
    excerpt: input.excerpt,
    content: input.content,
    updatedAt: now,
  };
  const next: LangVersion = existing
    ? { ...existing, ...fields }
    : { ...fields, status: "draft", publishAt: null, publishedAt: null };
  return withVersion(post, lang, next, now);
}

export function withoutVersion(post: Post, lang: Lang, now: string): Post {
  getVersion(post, lang);
  if (LANGS.filter((l) => post.versions[l]).length === 1) {
    throw new DomainError(
      "INVALID_STATE",
      "cannot remove the only language version, delete the post instead",
    );
  }
  return withVersion(post, lang, undefined, now);
}

export function publish(post: Post, lang: Lang, publishAt: string | undefined, now: string): Post {
  const current = getVersion(post, lang);
  if (current.status === "published") {
    throw new DomainError("INVALID_STATE", `${lang} version is already published`);
  }
  if (publishAt !== undefined) {
    const at = truncateToSecond(publishAt);
    if (Date.parse(at) - Date.parse(now) > SCHEDULE_MIN_LEAD_MS) {
      return withVersion(
        post,
        lang,
        { ...current, status: "scheduled", publishAt: at, updatedAt: now },
        now,
      );
    }
  }
  return withVersion(
    post,
    lang,
    {
      ...current,
      status: "published",
      publishAt: null,
      publishedAt: current.publishedAt ?? now,
      updatedAt: now,
    },
    now,
  );
}

export function unpublish(post: Post, lang: Lang, now: string): Post {
  const current = getVersion(post, lang);
  if (current.status === "draft") {
    throw new DomainError("INVALID_STATE", `${lang} version is not published or scheduled`);
  }
  return withVersion(
    post,
    lang,
    { ...current, status: "draft", publishAt: null, updatedAt: now },
    now,
  );
}

/** Returns null when the scheduled event is stale (rescheduled, unpublished, removed, other language). */
export function publishScheduled(
  post: Post,
  lang: Lang,
  scheduledFor: string,
  now: string,
): Post | null {
  const current = post.versions[lang];
  if (!current || current.status !== "scheduled" || current.publishAt !== scheduledFor) return null;
  return withVersion(
    post,
    lang,
    {
      ...current,
      status: "published",
      publishAt: null,
      publishedAt: current.publishedAt ?? scheduledFor,
      updatedAt: now,
    },
    now,
  );
}

const hasStatus = (post: Post, status: PostStatus) =>
  LANGS.some((lang) => post.versions[lang]?.status === status);

export const isPublished = (post: Post): boolean => hasStatus(post, "published");
export const isLive = (post: Post): boolean =>
  hasStatus(post, "published") || hasStatus(post, "scheduled");
export const scheduledLangs = (post: Post): Lang[] =>
  LANGS.filter((lang) => post.versions[lang]?.status === "scheduled");

export function slugEntries(post: Post): Array<{ lang: Lang; slug: string }> {
  return LANGS.flatMap((lang) => {
    const version = post.versions[lang];
    return version ? [{ lang, slug: version.slug }] : [];
  });
}

/** What readers can see: published versions plus shared fields, or null when nothing is published. */
function publicView(post: Post | null): string | null {
  if (!post) return null;
  const published = LANGS.flatMap((lang) => {
    const version = post.versions[lang];
    return version?.status === "published" ? [[lang, version] as const] : [];
  });
  if (published.length === 0) return null;
  return JSON.stringify({ tags: post.tags, coverImage: post.coverImage, published });
}

export function needsRebuild(before: Post | null, after: Post | null): boolean {
  return publicView(before) !== publicView(after);
}

export function toSummary(post: Post): PostSummary {
  const versions: PostSummary["versions"] = {};
  for (const lang of LANGS) {
    const version = post.versions[lang];
    if (version) {
      const { content: _content, ...summary } = version;
      versions[lang] = summary;
    }
  }
  return { ...post, versions };
}
