import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type Ref, useImperativeHandle } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarkdownEditorHandle } from "../../src/editor/MarkdownEditor";
import { EditorPage } from "../../src/pages/EditorPage";
import { makePost, makeVersion } from "../fixtures";
import { renderWithServices } from "../render";
import { serverLike } from "../server";

vi.mock("@blog/markdown", () => ({ renderMarkdown: async (md: string) => `<p>${md}</p>` }));

// CodeMirror needs layout APIs jsdom lacks; a textarea stands in with the same props.
vi.mock("../../src/editor/MarkdownEditor", () => ({
  MarkdownEditor: ({
    value,
    onChange,
    onImageFiles,
    ref,
  }: {
    value: string;
    onChange: (v: string) => void;
    onImageFiles?: (files: File[]) => void;
    ref?: Ref<MarkdownEditorHandle>;
  }) => {
    useImperativeHandle(ref, () => ({
      insertAtCursor: (text: string) => onChange(value + text),
      focus: () => {},
    }));
    return (
      <>
        <textarea aria-label="Nội dung" value={value} onChange={(e) => onChange(e.target.value)} />
        <input
          type="file"
          aria-label="Dán ảnh"
          onChange={(e) => onImageFiles?.(Array.from(e.target.files ?? []))}
        />
      </>
    );
  },
}));

const bilingual = () =>
  makePost({
    versions: {
      vi: makeVersion({ title: "Học AWS", content: "vi" }),
      ja: makeVersion({ title: "AWSを学ぶ", slug: "01jtestpost-ja", content: "ja" }),
    },
  });

async function open(post = bilingual(), autosaveDelayMs = 50) {
  const server = serverLike(post);
  const utils = renderWithServices(
    <EditorPage id={post.id} autosaveDelayMs={autosaveDelayMs} />,
    server.api,
  );
  await screen.findByLabelText("Nội dung");
  return { ...utils, server };
}

describe("EditorPage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("autosaves a draft shortly after typing stops", async () => {
    const { server } = await open();
    await userEvent.type(screen.getByLabelText("Nội dung"), " thêm");
    await waitFor(() => expect(server.api.upsertVersion).toHaveBeenCalledOnce());
    expect(server.api.upsertVersion).toHaveBeenCalledWith(
      "01JTESTPOST",
      "vi",
      expect.objectContaining({ content: "vi thêm", version: 1 }),
    );
    expect(await screen.findByText(/^đã lưu \d\d:\d\d$/)).toBeTruthy();
  });

  it("never autosaves a published version; Cập nhật saves it", async () => {
    const published = makePost({
      versions: { vi: makeVersion({ status: "published", publishedAt: "2026-10-01T00:00:00Z" }) },
    });
    const { server } = await open(published);
    const update = screen.getByRole("button", { name: "Cập nhật bản vi" });
    expect(update).toHaveProperty("disabled", true);
    await userEvent.type(screen.getByLabelText("Nội dung"), "!");
    await new Promise((r) => setTimeout(r, 200));
    expect(server.api.upsertVersion).not.toHaveBeenCalled();
    await userEvent.click(update);
    await waitFor(() => expect(server.api.upsertVersion).toHaveBeenCalledOnce());
  });

  it("saves pending changes at once when switching language tab", async () => {
    const { server } = await open(bilingual(), 60_000);
    await userEvent.type(screen.getByLabelText("Nội dung"), "!");
    await userEvent.click(screen.getByRole("tab", { name: /^ja/ }));
    await waitFor(() =>
      expect(server.api.upsertVersion).toHaveBeenCalledWith(
        "01JTESTPOST",
        "vi",
        expect.objectContaining({ content: "vi!" }),
      ),
    );
    expect(screen.getByLabelText("Nội dung")).toHaveProperty("value", "ja");
    expect(location.search).toBe("?lang=ja");
  });

  it("creates the missing language version", async () => {
    const { server } = await open(makePost());
    await userEvent.click(screen.getByRole("button", { name: "+ Tạo bản ja" }));
    await userEvent.type(screen.getByLabelText("Tiêu đề bản ja"), "秋");
    await userEvent.click(screen.getByRole("button", { name: "Tạo bản ja" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: /^ja/ })).toBeTruthy());
    expect(server.api.upsertVersion).toHaveBeenCalledWith(
      "01JTESTPOST",
      "ja",
      expect.objectContaining({ title: "秋", content: "" }),
    );
  });

  it("publishes the open tab", async () => {
    const { server } = await open();
    await userEvent.click(screen.getByRole("button", { name: "Đăng bản vi" }));
    await waitFor(() =>
      expect(server.api.publish).toHaveBeenCalledWith("01JTESTPOST", "vi", undefined),
    );
    expect(await screen.findByRole("button", { name: "Cập nhật bản vi" })).toBeTruthy();
  });

  it("schedules in the chosen zone", async () => {
    const { server } = await open();
    await userEvent.click(screen.getByRole("button", { name: "Thêm thao tác đăng" }));
    await userEvent.click(screen.getByRole("button", { name: "Hẹn giờ…" }));
    await userEvent.selectOptions(screen.getByLabelText("Múi giờ"), "jp");
    const field = screen.getByLabelText("Thời điểm");
    await userEvent.clear(field);
    await userEvent.type(field, "2099-01-01T08:00");
    await userEvent.click(screen.getByRole("button", { name: "Hẹn giờ" }));
    await waitFor(() =>
      expect(server.api.publish).toHaveBeenCalledWith(
        "01JTESTPOST",
        "vi",
        "2098-12-31T23:00:00.000Z",
      ),
    );
    expect(localStorage.getItem("oki-admin:zone")).toBe("jp");
    expect(await screen.findByRole("button", { name: "Hẹn 08:00 JST" })).toBeTruthy();
  });

  it("takes a published version down after confirming", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const published = makePost({
      versions: { vi: makeVersion({ status: "published", publishedAt: "2026-10-01T00:00:00Z" }) },
    });
    const { server } = await open(published);
    await userEvent.click(screen.getByRole("button", { name: "Thêm thao tác đăng" }));
    await userEvent.click(screen.getByRole("button", { name: "Gỡ bài" }));
    await waitFor(() => expect(server.api.unpublish).toHaveBeenCalledWith("01JTESTPOST", "vi"));
  });

  it("uploads a dropped image and inserts its Markdown", async () => {
    const { services } = await open();
    const file = new File(["x"], "la-phong.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Dán ảnh"), file);
    await waitFor(() =>
      expect(screen.getByLabelText("Nội dung")).toHaveProperty(
        "value",
        "vi![la-phong](https://blog.oki-dev.xyz/media/2026/la-phong.png)\n",
      ),
    );
    expect(services.uploadImage).toHaveBeenCalledWith(file);
  });

  it("toggles the info drawer and the write/preview tabs for narrow screens", async () => {
    await open();
    const grid = document.querySelector(".editor-grid") as HTMLElement;
    await userEvent.click(screen.getByRole("button", { name: "Thông tin bài" }));
    expect(grid.dataset.infoOpen).toBe("true");
    await userEvent.click(screen.getByRole("tab", { name: "Xem trước" }));
    expect(grid.dataset.pane).toBe("preview");
  });

  it("shows the conflict dialog when the post changed elsewhere", async () => {
    const { server } = await open();
    server.state.current = { ...server.state.current, version: 9 };
    await userEvent.type(screen.getByLabelText("Nội dung"), "!");
    expect(await screen.findByText("Bài vừa được sửa ở nơi khác")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Ghi đè bằng bản của tôi" }));
    await waitFor(() =>
      expect(server.api.upsertVersion).toHaveBeenLastCalledWith(
        "01JTESTPOST",
        "vi",
        expect.objectContaining({ version: 9 }),
      ),
    );
  });
});
