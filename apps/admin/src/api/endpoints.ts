import type {
  BuildState,
  ImageContentType,
  Lang,
  Post,
  PostSummary,
  Tag,
  TagSummary,
  UpdatePostInput,
  UploadTicket,
  UpsertVersionInput,
} from "@blog/shared";
import type { ApiClient } from "./client";

const enc = encodeURIComponent;

/** One function per API route (spec ui-i18n 3.5). */
export function endpoints(api: ApiClient) {
  return {
    listPosts: () => api.request<PostSummary[]>("GET", "/posts"),
    getPost: (id: string) => api.request<Post>("GET", `/posts/${enc(id)}`),
    createPost: (input: { lang: Lang; title: string }) =>
      api.request<Post>("POST", "/posts", input),
    updatePost: (id: string, input: UpdatePostInput) =>
      api.request<Post>("PUT", `/posts/${enc(id)}`, input),
    deletePost: (id: string) => api.request<void>("DELETE", `/posts/${enc(id)}`),
    upsertVersion: (id: string, lang: Lang, input: UpsertVersionInput) =>
      api.request<Post>("PUT", `/posts/${enc(id)}/versions/${lang}`, input),
    deleteVersion: (id: string, lang: Lang) =>
      api.request<Post>("DELETE", `/posts/${enc(id)}/versions/${lang}`),
    publish: (id: string, lang: Lang, publishAt?: string) =>
      api.request<Post>(
        "POST",
        `/posts/${enc(id)}/versions/${lang}/publish`,
        publishAt === undefined ? {} : { publishAt },
      ),
    unpublish: (id: string, lang: Lang) =>
      api.request<Post>("POST", `/posts/${enc(id)}/versions/${lang}/unpublish`),
    listTags: () => api.request<TagSummary[]>("GET", "/tags"),
    putTag: (key: string, names: Tag["names"]) =>
      api.request<Tag>("PUT", `/tags/${enc(key)}`, { names }),
    createUpload: (contentType: ImageContentType) =>
      api.request<UploadTicket>("POST", "/uploads", { contentType }),
    latestBuild: () => api.request<BuildState>("GET", "/builds/latest"),
    triggerBuild: () => api.request<BuildState>("POST", "/builds"),
  };
}

export type Endpoints = ReturnType<typeof endpoints>;
