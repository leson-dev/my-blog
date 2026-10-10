import { describe, expect, it } from "vitest";
import { handleScheduled } from "../../src/handlers/scheduled";
import { createPost, getPost } from "../../src/usecases/posts";
import { publishPost } from "../../src/usecases/publishing";
import { makeDeps } from "../fakes";

describe("handleScheduled", () => {
  it("publishes the post named in the event", async () => {
    const deps = makeDeps();
    const post = await createPost(deps, {
      title: "T",
      excerpt: "",
      content: "",
      tags: [],
      coverImage: null,
    });
    await publishPost(deps, post.id, { publishAt: "2026-10-12T08:00:00Z" });
    await handleScheduled(
      { type: "scheduled-publish", postId: post.id, publishAt: "2026-10-12T08:00:00.000Z" },
      deps,
    );
    expect((await getPost(deps, post.id)).status).toBe("published");
  });

  it("rejects a malformed event", async () => {
    await expect(handleScheduled({ type: "scheduled-publish" }, makeDeps())).rejects.toThrow();
  });
});
