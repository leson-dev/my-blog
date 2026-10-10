import type { BuildState, ImageContentType, Lang, Post, Tag } from "@blog/shared";

export interface PostRepository {
  get(id: string): Promise<Post | null>;
  /** Newest `updatedAt` first. */
  list(): Promise<Post[]>;
  /** Throws SLUG_TAKEN when any slug of the post is already used anywhere on the site. */
  create(post: Post): Promise<void>;
  /** Throws VERSION_CONFLICT when the stored version is not `prev.version`, SLUG_TAKEN on slug clash. */
  update(next: Post, prev: Post): Promise<void>;
  delete(post: Post): Promise<void>;
}

export interface TagRepository {
  /** Tags that have names, sorted by key. */
  list(): Promise<Tag[]>;
  put(tag: Tag): Promise<void>;
}

export interface BuildStatusRepository {
  get(): Promise<BuildState>;
  setQueued(now: string): Promise<void>;
  setFailed(now: string, error: string): Promise<void>;
}

export interface BuildQueue {
  enqueue(reason: string): Promise<void>;
}

export interface PublishScheduler {
  /** Creates or replaces the one-time schedule for one language version. */
  schedule(postId: string, lang: Lang, publishAt: string): Promise<void>;
  /** Removes the schedule; succeeds when it does not exist. */
  cancel(postId: string, lang: Lang): Promise<void>;
}

export interface UploadSigner {
  sign(
    key: string,
    contentType: ImageContentType,
  ): Promise<{ url: string; fields: Record<string, string> }>;
}

export interface Log {
  error(message: string, attributes: Record<string, unknown>): void;
}

export interface Deps {
  posts: PostRepository;
  tags: TagRepository;
  builds: BuildStatusRepository;
  buildQueue: BuildQueue;
  scheduler: PublishScheduler;
  uploads: UploadSigner;
  log: Log;
  now: () => string;
  newId: () => string;
  /** e.g. "https://blog.oki-dev.xyz", no trailing slash */
  blogBaseUrl: string;
}
