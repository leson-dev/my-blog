// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../src/api/client";
import { endpoints } from "../../src/api/endpoints";

function recording() {
  const request = vi.fn(async () => undefined);
  return { api: endpoints({ request } as unknown as ApiClient), request };
}

describe("endpoints", () => {
  it.each([
    ["listPosts", [], ["GET", "/posts"]],
    ["getPost", ["a b"], ["GET", "/posts/a%20b"]],
    ["createPost", [{ lang: "vi", title: "T" }], ["POST", "/posts", { lang: "vi", title: "T" }]],
    ["deletePost", ["p1"], ["DELETE", "/posts/p1"]],
    ["deleteVersion", ["p1", "ja"], ["DELETE", "/posts/p1/versions/ja"]],
    ["publish", ["p1", "vi"], ["POST", "/posts/p1/versions/vi/publish", {}]],
    [
      "publish",
      ["p1", "vi", "2026-10-11T23:00:00.000Z"],
      ["POST", "/posts/p1/versions/vi/publish", { publishAt: "2026-10-11T23:00:00.000Z" }],
    ],
    ["unpublish", ["p1", "ja"], ["POST", "/posts/p1/versions/ja/unpublish"]],
    ["listTags", [], ["GET", "/tags"]],
    [
      "putTag",
      ["doi-song", { vi: "Đời sống" }],
      ["PUT", "/tags/doi-song", { names: { vi: "Đời sống" } }],
    ],
    ["createUpload", ["image/webp"], ["POST", "/uploads", { contentType: "image/webp" }]],
    ["latestBuild", [], ["GET", "/builds/latest"]],
    ["triggerBuild", [], ["POST", "/builds"]],
  ] as const)("%s(%j)", async (name, args, expected) => {
    const { api, request } = recording();
    await (api[name] as (...a: unknown[]) => Promise<unknown>)(...args);
    expect(request).toHaveBeenCalledWith(...expected);
  });

  it("sends the shared fields and the version when updating a post", async () => {
    const { api, request } = recording();
    await api.updatePost("p1", { tags: ["aws"], coverImage: null, version: 3 });
    expect(request).toHaveBeenCalledWith("PUT", "/posts/p1", {
      tags: ["aws"],
      coverImage: null,
      version: 3,
    });
  });

  it("sends a language version", async () => {
    const { api, request } = recording();
    const input = { title: "T", excerpt: "", content: "# x", version: 2 };
    await api.upsertVersion("p1", "ja", input);
    expect(request).toHaveBeenCalledWith("PUT", "/posts/p1/versions/ja", input);
  });
});
