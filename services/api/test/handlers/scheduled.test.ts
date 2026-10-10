import { describe, expect, it } from "vitest";
import { handleScheduled } from "../../src/handlers/scheduled";
import { createPost, getPost } from "../../src/usecases/posts";
import { publishVersion } from "../../src/usecases/publishing";
import { makeDeps } from "../fakes";

describe("handleScheduled", () => {
  it("publishes the language named in the event", async () => {
    const deps = makeDeps();
    const post = await createPost(deps, {
      lang: "vi",
      title: "T",
      excerpt: "",
      content: "",
      tags: [],
      coverImage: null,
    });
    await publishVersion(deps, post.id, "vi", { publishAt: "2026-10-12T08:00:00Z" });
    await handleScheduled(
      {
        type: "scheduled-publish",
        postId: post.id,
        lang: "vi",
        publishAt: "2026-10-12T08:00:00.000Z",
      },
      deps,
    );
    expect((await getPost(deps, post.id)).versions.vi?.status).toBe("published");
  });

  it("rejects an event without a language", async () => {
    await expect(
      handleScheduled(
        { type: "scheduled-publish", postId: "P1", publishAt: "2026-10-12T08:00:00.000Z" },
        makeDeps(),
      ),
    ).rejects.toThrow();
  });
});
