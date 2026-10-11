import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client";
import { PostListPage } from "../../src/pages/PostListPage";
import { makePost, makeVersion, summaryOf } from "../fixtures";
import { fakeApi, renderWithServices } from "../render";

const posts = [
  summaryOf(
    makePost({ id: "A", tags: ["aws"], versions: { vi: makeVersion({ title: "Học AWS" }) } }),
  ),
  summaryOf(
    makePost({
      id: "B",
      updatedAt: "2026-10-12T00:00:00Z",
      versions: { ja: makeVersion({ title: "紅葉", status: "published" }) },
    }),
  ),
];

describe("PostListPage", () => {
  it("lists posts with per-language status, tags and links to the editor", async () => {
    renderWithServices(<PostListPage />, fakeApi({ listPosts: vi.fn(async () => posts) }));
    const link = await screen.findByRole("link", { name: "Học AWS" });
    expect(link.getAttribute("href")).toBe("/posts/A");
    const row = link.closest("li") as HTMLElement;
    expect(within(row).getByText("vi: nháp")).toBeTruthy();
    expect(within(row).getByText("ja: —")).toBeTruthy();
    expect(within(row).getByText("#aws")).toBeTruthy();
  });

  it("filters by status and title", async () => {
    renderWithServices(<PostListPage />, fakeApi({ listPosts: vi.fn(async () => posts) }));
    await screen.findByRole("link", { name: "Học AWS" });
    await userEvent.selectOptions(screen.getByLabelText("Trạng thái"), "published");
    expect(screen.queryByRole("link", { name: "Học AWS" })).toBeNull();
    expect(screen.getByRole("link", { name: "紅葉" })).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText("Trạng thái"), "all");
    await userEvent.type(screen.getByLabelText("Tìm theo tiêu đề"), "hoc");
    expect(screen.queryByRole("link", { name: "紅葉" })).toBeNull();
  });

  it("creates a post in the chosen language and opens it", async () => {
    const createPost = vi.fn(async () => makePost({ id: "NEW", versions: { ja: makeVersion() } }));
    renderWithServices(<PostListPage />, fakeApi({ createPost }));
    await userEvent.click(screen.getByRole("button", { name: "+ Bài mới" }));
    await userEvent.click(screen.getByLabelText("ja"));
    await userEvent.type(screen.getByLabelText("Tiêu đề"), "秋の京都");
    await userEvent.click(screen.getByRole("button", { name: "Tạo" }));
    expect(createPost).toHaveBeenCalledWith({ lang: "ja", title: "秋の京都" });
    expect(location.pathname + location.search).toBe("/posts/NEW?lang=ja");
  });

  it("explains a taken slug", async () => {
    const createPost = vi.fn(async () => {
      throw new ApiError(409, "SLUG_TAKEN", "slug taken");
    });
    renderWithServices(<PostListPage />, fakeApi({ createPost }));
    await userEvent.click(screen.getByRole("button", { name: "+ Bài mới" }));
    await userEvent.type(screen.getByLabelText("Tiêu đề"), "Học AWS");
    await userEvent.click(screen.getByRole("button", { name: "Tạo" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Slug này đã có bài khác dùng");
  });
});
