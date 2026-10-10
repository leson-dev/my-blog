import type { PutTagInput, Tag, TagSummary } from "@blog/shared";
import { DomainError } from "../domain/errors";
import { isLive, isPublished } from "../domain/post";
import { isValidSlug } from "../domain/slug";
import { afterCommit } from "./afterCommit";
import { requestBuild } from "./builds";
import type { Deps } from "./ports";
import { AUTHOR, type Caller } from "./posts";

export async function listTags(deps: Deps): Promise<TagSummary[]> {
  const [posts, named] = await Promise.all([deps.posts.list(), deps.tags.list()]);
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const key of post.tags) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const names = new Map(named.map((tag) => [tag.key, tag.names]));
  const keys = [...new Set([...counts.keys(), ...names.keys()])].sort();
  return keys.map((key) => ({ key, names: names.get(key) ?? {}, postCount: counts.get(key) ?? 0 }));
}

export async function putTag(
  deps: Deps,
  key: string,
  input: PutTagInput,
  caller: Caller = AUTHOR,
): Promise<Tag> {
  if (!isValidSlug(key)) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "tag key must be lowercase latin letters, digits and dashes",
    );
  }
  const users = (await deps.posts.list()).filter((post) => post.tags.includes(key));
  if (caller.e2e && users.some(isLive)) {
    throw new DomainError("FORBIDDEN", "the e2e account cannot rename a tag used by a live post");
  }
  const tag: Tag = { key, names: input.names };
  await deps.tags.put(tag);
  if (users.some(isPublished)) {
    await afterCommit(deps, "build request", () => requestBuild(deps, `tag:${key}`));
  }
  return tag;
}
