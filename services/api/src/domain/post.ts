import type { CreatePostInput, Post, PostSummary, UpdatePostInput } from "@blog/shared";
import { DomainError } from "./errors";
import { isValidSlug, normalizeTags, slugify } from "./slug";

/** Schedules closer than this are published immediately instead. */
export const SCHEDULE_MIN_LEAD_MS = 60_000;

function resolveSlug(requested: string, title: string, id: string): string {
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
  return fromTitle !== "" ? fromTitle : id.toLowerCase();
}

function truncateToSecond(iso: string): string {
  const ms = Date.parse(iso);
  return new Date(ms - (ms % 1000)).toISOString();
}

export function newPost(input: CreatePostInput, ctx: { id: string; now: string }): Post {
  return {
    id: ctx.id,
    slug: resolveSlug(input.slug ?? "", input.title, ctx.id),
    title: input.title,
    excerpt: input.excerpt,
    content: input.content,
    tags: normalizeTags(input.tags),
    coverImage: input.coverImage,
    status: "draft",
    publishAt: null,
    publishedAt: null,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    version: 1,
  };
}

export function applyUpdate(post: Post, input: UpdatePostInput, now: string): Post {
  if (input.version !== post.version) {
    throw new DomainError(
      "VERSION_CONFLICT",
      `post was modified elsewhere (current version ${post.version})`,
    );
  }
  return {
    ...post,
    title: input.title,
    slug: resolveSlug(input.slug, input.title, post.id),
    excerpt: input.excerpt,
    content: input.content,
    tags: normalizeTags(input.tags),
    coverImage: input.coverImage,
    updatedAt: now,
    version: post.version + 1,
  };
}

export function publish(post: Post, publishAt: string | undefined, now: string): Post {
  if (post.status === "published") {
    throw new DomainError("INVALID_STATE", "post is already published");
  }
  const bumped = { ...post, updatedAt: now, version: post.version + 1 };
  if (publishAt !== undefined) {
    const at = truncateToSecond(publishAt);
    if (Date.parse(at) - Date.parse(now) > SCHEDULE_MIN_LEAD_MS) {
      return { ...bumped, status: "scheduled", publishAt: at };
    }
  }
  return { ...bumped, status: "published", publishAt: null, publishedAt: post.publishedAt ?? now };
}

export function unpublish(post: Post, now: string): Post {
  if (post.status === "draft") {
    throw new DomainError("INVALID_STATE", "post is not published or scheduled");
  }
  return { ...post, status: "draft", publishAt: null, updatedAt: now, version: post.version + 1 };
}

/** Returns null when the scheduled event is stale (post rescheduled, unpublished or published). */
export function publishScheduled(post: Post, scheduledFor: string, now: string): Post | null {
  if (post.status !== "scheduled" || post.publishAt !== scheduledFor) return null;
  return {
    ...post,
    status: "published",
    publishAt: null,
    publishedAt: post.publishedAt ?? scheduledFor,
    updatedAt: now,
    version: post.version + 1,
  };
}

/** The public site only changes when a published post is involved before or after the change. */
export function needsRebuild(before: Post | null, after: Post | null): boolean {
  return before?.status === "published" || after?.status === "published";
}

export function toSummary(post: Post): PostSummary {
  const { content: _content, ...summary } = post;
  return summary;
}
