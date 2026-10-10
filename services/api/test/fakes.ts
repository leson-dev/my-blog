import type { BuildState, ImageContentType, Lang, Post, Tag } from "@blog/shared";
import { DomainError } from "../src/domain/errors";
import { slugEntries } from "../src/domain/post";
import type {
  BuildQueue,
  BuildStatusRepository,
  Deps,
  PostRepository,
  PublishScheduler,
  TagRepository,
  UploadSigner,
} from "../src/usecases/ports";

export class InMemoryPostRepository implements PostRepository {
  readonly items = new Map<string, Post>();

  async get(id: string) {
    const post = this.items.get(id);
    return post ? structuredClone(post) : null;
  }

  async list() {
    return [...this.items.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((p) => structuredClone(p));
  }

  async create(post: Post) {
    this.assertSlugsFree(post);
    this.items.set(post.id, structuredClone(post));
  }

  async update(next: Post, prev: Post) {
    const current = this.items.get(prev.id);
    if (!current || current.version !== prev.version) {
      throw new DomainError("VERSION_CONFLICT", "post was modified elsewhere");
    }
    this.assertSlugsFree(next);
    this.items.set(next.id, structuredClone(next));
  }

  async delete(post: Post) {
    this.items.delete(post.id);
  }

  /** Mirrors the site-wide SLUG#<slug> reservations of the DynamoDB repository. */
  private assertSlugsFree(post: Post) {
    const mine = slugEntries(post).map((e) => e.slug);
    const taken = (slug: string) => new DomainError("SLUG_TAKEN", `slug "${slug}" is already used`);
    const duplicate = mine.find((slug, i) => mine.indexOf(slug) !== i);
    if (duplicate) throw taken(duplicate);
    for (const other of this.items.values()) {
      if (other.id === post.id) continue;
      for (const { slug } of slugEntries(other)) if (mine.includes(slug)) throw taken(slug);
    }
  }
}

export class InMemoryTagRepository implements TagRepository {
  readonly items = new Map<string, Tag>();

  async list() {
    return [...this.items.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((t) => structuredClone(t));
  }

  async put(tag: Tag) {
    this.items.set(tag.key, structuredClone(tag));
  }
}

export class FakeBuildStatusRepository implements BuildStatusRepository {
  state: BuildState = { status: "idle", updatedAt: null, error: null };

  async get() {
    return { ...this.state };
  }

  async setQueued(now: string) {
    this.state = { status: "queued", updatedAt: now, error: null };
  }

  async setFailed(now: string, error: string) {
    this.state = { status: "failed", updatedAt: now, error };
  }
}

export class RecordingBuildQueue implements BuildQueue {
  readonly reasons: string[] = [];
  failWith: Error | null = null;

  async enqueue(reason: string) {
    if (this.failWith) throw this.failWith;
    this.reasons.push(reason);
  }
}

/** Keys are "<postId>:<lang>". */
export class RecordingScheduler implements PublishScheduler {
  readonly scheduled = new Map<string, string>();
  readonly cancelled: string[] = [];
  failWith: Error | null = null;
  cancelFailWith: Error | null = null;

  async schedule(postId: string, lang: Lang, publishAt: string) {
    if (this.failWith) throw this.failWith;
    this.scheduled.set(`${postId}:${lang}`, publishAt);
  }

  async cancel(postId: string, lang: Lang) {
    if (this.cancelFailWith) throw this.cancelFailWith;
    this.scheduled.delete(`${postId}:${lang}`);
    this.cancelled.push(`${postId}:${lang}`);
  }
}

export class FakeUploadSigner implements UploadSigner {
  async sign(key: string, contentType: ImageContentType) {
    return { url: "https://uploads.example", fields: { key, "Content-Type": contentType } };
  }
}

export class RecordingLog {
  readonly errors: Array<{ message: string; attributes: Record<string, unknown> }> = [];

  error(message: string, attributes: Record<string, unknown>) {
    this.errors.push({ message, attributes });
  }
}

export interface TestDeps extends Deps {
  posts: InMemoryPostRepository;
  tags: InMemoryTagRepository;
  builds: FakeBuildStatusRepository;
  buildQueue: RecordingBuildQueue;
  scheduler: RecordingScheduler;
  log: RecordingLog;
  /** Change to move the fake clock. */
  clock: { now: string };
}

export function makeDeps(): TestDeps {
  let seq = 0;
  const clock = { now: "2026-10-10T00:00:00.000Z" };
  return {
    posts: new InMemoryPostRepository(),
    tags: new InMemoryTagRepository(),
    builds: new FakeBuildStatusRepository(),
    buildQueue: new RecordingBuildQueue(),
    scheduler: new RecordingScheduler(),
    uploads: new FakeUploadSigner(),
    log: new RecordingLog(),
    clock,
    now: () => clock.now,
    newId: () => `01J${String(++seq).padStart(23, "0")}`,
    blogBaseUrl: "https://blog.oki-dev.xyz",
  };
}
