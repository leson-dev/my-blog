import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client";
import { draftFrom, slugToSend, usePostEditor } from "../../src/editor/usePostEditor";
import { makePost, makeVersion } from "../fixtures";
import { serverLike } from "../server";

async function loaded(post = makePost(), onPublicChange = vi.fn()) {
  const server = serverLike(post);
  const hook = renderHook(() => usePostEditor(server.api, post.id, onPublicChange));
  await waitFor(() => expect(hook.result.current.post).not.toBeNull());
  return { ...hook, server, onPublicChange };
}

describe("slug rules", () => {
  const draft = draftFrom(makeVersion({ title: "Học AWS", slug: "hoc-aws" }), "01J", "vi");

  it("follows the title until the version is first published", () => {
    expect(draft.slugTouched).toBe(false);
    expect(slugToSend(makeVersion(), { ...draft, title: "Học CDK" })).toBe("hoc-cdk");
    expect(
      slugToSend(makeVersion({ publishedAt: "2026-10-01T00:00:00Z" }), {
        ...draft,
        title: "Học CDK",
      }),
    ).toBeUndefined();
  });

  it("lets the server keep the <id>-ja fallback for a Japanese title", () => {
    const ja = draftFrom(makeVersion({ title: "紅葉", slug: "01j-ja" }), "01J", "ja");
    expect(ja.slugTouched).toBe(false);
    expect(slugToSend(makeVersion(), { ...ja, title: "秋の京都" })).toBeUndefined();
  });

  it("keeps a slug written by hand", () => {
    const custom = draftFrom(makeVersion({ title: "Học AWS", slug: "aws-101" }), "01J", "vi");
    expect(custom.slugTouched).toBe(true);
    expect(slugToSend(makeVersion(), { ...custom, title: "Khác" })).toBe("aws-101");
  });
});

describe("usePostEditor", () => {
  it("saves one call at a time, each with the version the previous call returned", async () => {
    const { result, server } = await loaded();
    act(() => result.current.edit("vi", { content: "một" }));
    await act(async () => {
      const first = result.current.saveVersion("vi");
      const second = result.current.saveVersion("vi");
      await Promise.all([first, second]);
    });
    expect(server.api.upsertVersion.mock.calls.map((c) => c[2].version)).toEqual([1, 2]);
    expect(result.current.conflict).toBe(false);
    expect(result.current.post?.version).toBe(3);
  });

  it("keeps the draft dirty when typing continued during the save", async () => {
    const { result, server } = await loaded();
    let release = () => {};
    const original = server.api.upsertVersion.getMockImplementation();
    server.api.upsertVersion.mockImplementationOnce(async (...args) => {
      await new Promise<void>((r) => {
        release = r;
      });
      return original?.(...args) as never;
    });
    act(() => result.current.edit("vi", { content: "a" }));
    let saving: Promise<boolean> = Promise.resolve(true);
    act(() => {
      saving = result.current.saveVersion("vi");
    });
    await waitFor(() => expect(server.api.upsertVersion).toHaveBeenCalledOnce());
    act(() => result.current.edit("vi", { content: "ab" }));
    await act(async () => {
      release();
      await saving;
    });
    expect(result.current.drafts.vi?.dirty).toBe(true);
    expect(result.current.drafts.vi?.content).toBe("ab");
  });

  it("refuses to save an empty title", async () => {
    const { result, server } = await loaded();
    act(() => result.current.edit("vi", { title: "  " }));
    await act(async () => {
      expect(await result.current.saveVersion("vi")).toBe(false);
    });
    expect(result.current.error).toBe("Tiêu đề không được để trống");
    expect(server.api.upsertVersion).not.toHaveBeenCalled();
  });

  it("asks what to do on a conflict and can overwrite with the local draft", async () => {
    const { result, server } = await loaded();
    server.state.current = { ...server.state.current, version: 5 };
    act(() => result.current.edit("vi", { content: "của tôi" }));
    await act(async () => {
      await result.current.saveVersion("vi");
    });
    expect(result.current.conflict).toBe(true);

    await act(async () => {
      await result.current.resolveConflict("overwrite");
    });
    expect(result.current.conflict).toBe(false);
    expect(server.api.upsertVersion).toHaveBeenLastCalledWith(
      "01JTESTPOST",
      "vi",
      expect.objectContaining({ version: 5, content: "của tôi" }),
    );
  });

  it("can reload the server copy instead", async () => {
    const { result, server } = await loaded();
    server.state.current = {
      ...server.state.current,
      version: 5,
      versions: { vi: makeVersion({ content: "bản mới" }) },
    };
    act(() => result.current.edit("vi", { content: "của tôi" }));
    await act(async () => {
      await result.current.saveVersion("vi");
    });
    await act(async () => {
      await result.current.resolveConflict("reload");
    });
    expect(result.current.drafts.vi).toMatchObject({ content: "bản mới", dirty: false });
  });

  it("tells the build bar when a published version or shared field changes", async () => {
    const published = makePost({
      versions: { vi: makeVersion({ status: "published", publishedAt: "2026-10-01T00:00:00Z" }) },
    });
    const { result, onPublicChange } = await loaded(published);
    act(() => result.current.edit("vi", { content: "sửa" }));
    await act(async () => {
      await result.current.saveVersion("vi");
      await result.current.saveShared({ tags: ["aws"], coverImage: null });
    });
    expect(onPublicChange).toHaveBeenCalledTimes(2);
  });

  it("saves a dirty draft before publishing it", async () => {
    const { result, server } = await loaded();
    act(() => result.current.edit("vi", { content: "xong" }));
    await act(async () => {
      expect(await result.current.publish("vi")).toBe(true);
    });
    expect(server.api.upsertVersion).toHaveBeenCalledOnce();
    expect(server.api.publish).toHaveBeenCalledWith("01JTESTPOST", "vi", undefined);
    expect(result.current.post?.versions.vi?.status).toBe("published");
  });

  it("shows other API errors", async () => {
    const { result, server } = await loaded();
    server.api.upsertVersion.mockRejectedValueOnce(new ApiError(409, "SLUG_TAKEN", "x"));
    act(() => result.current.edit("vi", { content: "x" }));
    await act(async () => {
      await result.current.saveVersion("vi");
    });
    expect(result.current.error).toBe("Slug này đã có bài khác dùng");
  });
});
