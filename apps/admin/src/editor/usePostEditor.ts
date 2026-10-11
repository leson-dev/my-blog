import {
  LANGS,
  type Lang,
  type LangVersion,
  type Post,
  slugify,
  type UpdatePostInput,
} from "@blog/shared";
import { useEffect, useRef, useState } from "react";
import { ApiError, errorMessage } from "../api/client";
import type { Endpoints } from "../api/endpoints";

export interface Draft {
  title: string;
  content: string;
  excerpt: string;
  slug: string;
  /** The author edited the slug by hand: stop deriving it from the title. */
  slugTouched: boolean;
  dirty: boolean;
}

export type Drafts = Partial<Record<Lang, Draft>>;
export type EditableField = "title" | "content" | "excerpt" | "slug";

const fallbackSlug = (id: string, lang: Lang) => `${id.toLowerCase()}-${lang}`;

export function draftFrom(v: LangVersion, id: string, lang: Lang): Draft {
  const followsTitle = v.slug === slugify(v.title) || v.slug === fallbackSlug(id, lang);
  return {
    title: v.title,
    content: v.content,
    excerpt: v.excerpt,
    slug: v.slug,
    slugTouched: !followsTitle,
    dirty: false,
  };
}

export function draftsFromPost(post: Post): Drafts {
  const drafts: Drafts = {};
  for (const lang of LANGS) {
    const v = post.versions[lang];
    if (v) drafts[lang] = draftFrom(v, post.id, lang);
  }
  return drafts;
}

/**
 * Slug to send with a save: follows the title until the version is first published
 * (a public URL never moves by itself) or the author types a slug. `undefined` = server keeps it.
 */
export function slugToSend(version: LangVersion | undefined, draft: Draft): string | undefined {
  if (draft.slugTouched) return draft.slug;
  if (version?.publishedAt) return undefined;
  const fromTitle = slugify(draft.title);
  return fromTitle === "" ? undefined : fromTitle;
}

const hasPublished = (p: Post) => LANGS.some((l) => p.versions[l]?.status === "published");

export function usePostEditor(api: Endpoints, id: string, onPublicChange: () => void = () => {}) {
  const [post, setPostState] = useState<Post | null>(null);
  const [drafts, setDraftsState] = useState<Drafts>({});
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const postRef = useRef<Post | null>(null);
  const draftsRef = useRef<Drafts>({});
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const retryRef = useRef<(() => Promise<unknown>) | null>(null);
  const publicChange = useRef(onPublicChange);
  publicChange.current = onPublicChange;

  const setPost = (p: Post) => {
    postRef.current = p;
    setPostState(p);
  };
  const setDrafts = (next: Drafts) => {
    draftsRef.current = next;
    setDraftsState(next);
  };

  useEffect(() => {
    let alive = true;
    api.getPost(id).then(
      (p) => {
        if (!alive) return;
        postRef.current = p;
        setPostState(p);
        draftsRef.current = draftsFromPost(p);
        setDraftsState(draftsRef.current);
      },
      (err: unknown) => {
        if (alive) setError(errorMessage(err));
      },
    );
    return () => {
      alive = false;
    };
  }, [api, id]);

  /** Server calls run one at a time, each with the post `version` the previous one returned. */
  function run<T>(op: (current: Post) => Promise<T>): Promise<T | undefined> {
    const task = queue.current.then(async () => {
      const current = postRef.current;
      if (!current) return undefined;
      setPending((n) => n + 1);
      try {
        const result = await op(current);
        setError(null);
        return result;
      } catch (err) {
        if (err instanceof ApiError && err.code === "VERSION_CONFLICT") {
          retryRef.current = () => run(op);
          setConflict(true);
        } else {
          setError(errorMessage(err));
        }
        return undefined;
      } finally {
        setPending((n) => n - 1);
      }
    });
    queue.current = task;
    return task;
  }

  function edit(lang: Lang, patch: Partial<Pick<Draft, EditableField>>) {
    const draft = draftsRef.current[lang];
    if (!draft) return;
    setDrafts({
      ...draftsRef.current,
      [lang]: {
        ...draft,
        ...patch,
        slugTouched: draft.slugTouched || patch.slug !== undefined,
        dirty: true,
      },
    });
  }

  async function saveVersion(lang: Lang): Promise<boolean> {
    const ok = await run(async (current) => {
      const draft = draftsRef.current[lang];
      if (!draft) return true;
      if (draft.title.trim() === "") throw new Error("Tiêu đề không được để trống");
      const wasPublished = current.versions[lang]?.status === "published";
      const updated = await api.upsertVersion(current.id, lang, {
        title: draft.title.trim(),
        slug: slugToSend(current.versions[lang], draft),
        excerpt: draft.excerpt,
        content: draft.content,
        version: current.version,
      });
      setPost(updated);
      const now = draftsRef.current[lang];
      if (now) {
        const serverSlug = updated.versions[lang]?.slug ?? now.slug;
        setDrafts({
          ...draftsRef.current,
          // Typing that happened while the request was in flight stays dirty.
          [lang]: {
            ...now,
            slug: now.slugTouched ? now.slug : serverSlug,
            dirty: now === draft ? false : now.dirty,
          },
        });
      }
      setSavedAt(updated.updatedAt);
      if (wasPublished) publicChange.current();
      return true;
    });
    return ok === true;
  }

  async function createVersion(lang: Lang, title: string): Promise<boolean> {
    const ok = await run(async (current) => {
      const updated = await api.upsertVersion(current.id, lang, {
        title: title.trim(),
        excerpt: "",
        content: "",
        version: current.version,
      });
      setPost(updated);
      const v = updated.versions[lang];
      if (v) setDrafts({ ...draftsRef.current, [lang]: draftFrom(v, updated.id, lang) });
      setSavedAt(updated.updatedAt);
      return true;
    });
    return ok === true;
  }

  async function deleteVersion(lang: Lang): Promise<boolean> {
    const ok = await run(async (current) => {
      const wasPublished = current.versions[lang]?.status === "published";
      const updated = await api.deleteVersion(current.id, lang);
      setPost(updated);
      const { [lang]: _removed, ...rest } = draftsRef.current;
      setDrafts(rest);
      if (wasPublished) publicChange.current();
      return true;
    });
    return ok === true;
  }

  async function saveShared(input: Omit<UpdatePostInput, "version">): Promise<boolean> {
    const ok = await run(async (current) => {
      const updated = await api.updatePost(current.id, { ...input, version: current.version });
      setPost(updated);
      setSavedAt(updated.updatedAt);
      if (hasPublished(current)) publicChange.current();
      return true;
    });
    return ok === true;
  }

  async function publish(lang: Lang, publishAt?: string): Promise<boolean> {
    if (draftsRef.current[lang]?.dirty && !(await saveVersion(lang))) return false;
    const ok = await run(async (current) => {
      setPost(await api.publish(current.id, lang, publishAt));
      publicChange.current();
      return true;
    });
    return ok === true;
  }

  async function unpublish(lang: Lang): Promise<boolean> {
    const ok = await run(async (current) => {
      setPost(await api.unpublish(current.id, lang));
      publicChange.current();
      return true;
    });
    return ok === true;
  }

  async function deletePost(): Promise<boolean> {
    const ok = await run(async (current) => {
      await api.deletePost(current.id);
      if (hasPublished(current)) publicChange.current();
      return true;
    });
    return ok === true;
  }

  async function resolveConflict(choice: "reload" | "overwrite"): Promise<void> {
    const retry = retryRef.current;
    retryRef.current = null;
    setConflict(false);
    try {
      const latest = await api.getPost(id);
      setPost(latest);
      if (choice === "reload") {
        setDrafts(draftsFromPost(latest));
        return;
      }
      await retry?.();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return {
    post,
    drafts,
    savedAt,
    saving: pending > 0,
    error,
    conflict,
    edit,
    saveVersion,
    createVersion,
    deleteVersion,
    saveShared,
    publish,
    unpublish,
    deletePost,
    resolveConflict,
    dismissError: () => setError(null),
  };
}

export type PostEditor = ReturnType<typeof usePostEditor>;
