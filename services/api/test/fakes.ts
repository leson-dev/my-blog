import type { BuildState, ImageContentType, Post } from "@blog/shared";
import { DomainError } from "../src/domain/errors";
import type {
  BuildQueue,
  BuildStatusRepository,
  Deps,
  PostRepository,
  PublishScheduler,
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
    this.assertSlugFree(post.slug, post.id);
    this.items.set(post.id, structuredClone(post));
  }

  async update(next: Post, prev: Post) {
    const current = this.items.get(prev.id);
    if (!current || current.version !== prev.version) {
      throw new DomainError("VERSION_CONFLICT", "post was modified elsewhere");
    }
    this.assertSlugFree(next.slug, next.id);
    this.items.set(next.id, structuredClone(next));
  }

  async delete(post: Post) {
    this.items.delete(post.id);
  }

  private assertSlugFree(slug: string, ownerId: string) {
    for (const p of this.items.values()) {
      if (p.slug === slug && p.id !== ownerId) {
        throw new DomainError("SLUG_TAKEN", `slug "${slug}" is already used`);
      }
    }
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

export class RecordingScheduler implements PublishScheduler {
  readonly scheduled = new Map<string, string>();
  readonly cancelled: string[] = [];
  failWith: Error | null = null;

  async schedule(postId: string, publishAt: string) {
    if (this.failWith) throw this.failWith;
    this.scheduled.set(postId, publishAt);
  }

  async cancel(postId: string) {
    this.scheduled.delete(postId);
    this.cancelled.push(postId);
  }
}

export class FakeUploadSigner implements UploadSigner {
  async sign(key: string, contentType: ImageContentType) {
    return { url: "https://uploads.example", fields: { key, "Content-Type": contentType } };
  }
}

export interface TestDeps extends Deps {
  posts: InMemoryPostRepository;
  builds: FakeBuildStatusRepository;
  buildQueue: RecordingBuildQueue;
  scheduler: RecordingScheduler;
  /** Change to move the fake clock. */
  clock: { now: string };
}

export function makeDeps(): TestDeps {
  let seq = 0;
  const clock = { now: "2026-10-10T00:00:00.000Z" };
  return {
    posts: new InMemoryPostRepository(),
    builds: new FakeBuildStatusRepository(),
    buildQueue: new RecordingBuildQueue(),
    scheduler: new RecordingScheduler(),
    uploads: new FakeUploadSigner(),
    clock,
    now: () => clock.now,
    newId: () => `01J${String(++seq).padStart(23, "0")}`,
    blogBaseUrl: "https://blog.oki-dev.xyz",
  };
}
