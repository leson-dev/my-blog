import type { Lang, Post, UpdatePostInput, UpsertVersionInput } from "@blog/shared";
import { type Mock, vi } from "vitest";
import { ApiError } from "../src/api/client";
import type { Endpoints } from "../src/api/endpoints";
import { makeVersion } from "./fixtures";
import { fakeApi } from "./render";

/** Endpoints whose functions are vitest mocks (for call assertions). */
export type MockedEndpoints = { [K in keyof Endpoints]: Mock<Endpoints[K]> };

const tick = (p: Post): Post => ({
  ...p,
  version: p.version + 1,
  updatedAt: new Date(Date.parse(p.updatedAt) + 60_000).toISOString(),
});

/** In-memory post with the API's optimistic locking: a stale `version` gets 409. */
export function serverLike(initial: Post) {
  const state = { current: initial };
  const guard = (version: number) => {
    if (version !== state.current.version) {
      throw new ApiError(409, "VERSION_CONFLICT", "version mismatch");
    }
  };

  const upsertVersion = vi.fn(async (_id: string, lang: Lang, input: UpsertVersionInput) => {
    guard(input.version);
    const prev = state.current.versions[lang] ?? makeVersion({ slug: `x-${lang}` });
    state.current = tick({
      ...state.current,
      versions: {
        ...state.current.versions,
        [lang]: {
          ...prev,
          title: input.title,
          excerpt: input.excerpt,
          content: input.content,
          slug: input.slug && input.slug !== "" ? input.slug : prev.slug,
        },
      },
    });
    return state.current;
  });

  const updatePost = vi.fn(async (_id: string, input: UpdatePostInput) => {
    guard(input.version);
    state.current = tick({ ...state.current, tags: input.tags, coverImage: input.coverImage });
    return state.current;
  });

  const setStatus = (lang: Lang, patch: Partial<NonNullable<Post["versions"]["vi"]>>) => {
    const v = state.current.versions[lang];
    if (!v) throw new ApiError(404, "NOT_FOUND", "no version");
    state.current = tick({
      ...state.current,
      versions: { ...state.current.versions, [lang]: { ...v, ...patch } },
    });
    return state.current;
  };

  const api = fakeApi({
    getPost: vi.fn(async () => state.current),
    upsertVersion,
    updatePost,
    publish: vi.fn(async (_id: string, lang: Lang, publishAt?: string) =>
      publishAt
        ? setStatus(lang, { status: "scheduled", publishAt })
        : setStatus(lang, {
            status: "published",
            publishAt: null,
            publishedAt: "2026-10-11T00:00:00.000Z",
          }),
    ),
    unpublish: vi.fn(async (_id: string, lang: Lang) =>
      setStatus(lang, { status: "draft", publishAt: null }),
    ),
    deleteVersion: vi.fn(async (_id: string, lang: Lang) => {
      const { [lang]: _removed, ...rest } = state.current.versions;
      state.current = tick({ ...state.current, versions: rest });
      return state.current;
    }),
    deletePost: vi.fn(async () => undefined),
  }) as unknown as MockedEndpoints;
  return { api, state };
}
