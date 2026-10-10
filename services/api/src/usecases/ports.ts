import type { BuildState, ImageContentType, Post } from "@blog/shared";

export interface PostRepository {
  get(id: string): Promise<Post | null>;
  /** Newest `updatedAt` first. */
  list(): Promise<Post[]>;
  /** Throws DomainError SLUG_TAKEN when the slug is used by another post. */
  create(post: Post): Promise<void>;
  /** Throws VERSION_CONFLICT when the stored version is not `prev.version`, SLUG_TAKEN on slug clash. */
  update(next: Post, prev: Post): Promise<void>;
  delete(post: Post): Promise<void>;
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
  /** Creates or replaces the one-time schedule for the post. */
  schedule(postId: string, publishAt: string): Promise<void>;
  /** Removes the schedule; succeeds when it does not exist. */
  cancel(postId: string): Promise<void>;
}

export interface UploadSigner {
  sign(
    key: string,
    contentType: ImageContentType,
  ): Promise<{ url: string; fields: Record<string, string> }>;
}

export interface Deps {
  posts: PostRepository;
  builds: BuildStatusRepository;
  buildQueue: BuildQueue;
  scheduler: PublishScheduler;
  uploads: UploadSigner;
  now: () => string;
  newId: () => string;
  /** e.g. "https://blog.oki-dev.xyz", no trailing slash */
  blogBaseUrl: string;
}
