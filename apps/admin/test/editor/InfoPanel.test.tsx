import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InfoPanel } from "../../src/editor/InfoPanel";
import { draftFrom } from "../../src/editor/usePostEditor";
import { makePost, makeVersion } from "../fixtures";

function setup(post = makePost(), title = "Học CDK") {
  const draft = { ...draftFrom(post.versions.vi ?? makeVersion(), post.id, "vi"), title };
  const props = {
    post,
    lang: "vi" as const,
    draft,
    knownTags: [],
    onEdit: vi.fn(),
    onSaveShared: vi.fn(async () => true),
    onCreateTag: vi.fn(async () => {}),
    onDeleteVersion: vi.fn(),
    onDeletePost: vi.fn(),
  };
  render(<InfoPanel {...props} />);
  return props;
}

describe("InfoPanel", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows the slug the title will produce", () => {
    setup();
    expect(screen.getByLabelText("Slug")).toHaveProperty("value", "hoc-cdk");
    expect(screen.getByText("tự theo tiêu đề")).toBeTruthy();
  });

  it("reports slug and excerpt edits", async () => {
    const props = setup();
    await userEvent.type(screen.getByLabelText("Tóm tắt"), "a");
    expect(props.onEdit).toHaveBeenLastCalledWith({ excerpt: "a" });
    await userEvent.clear(screen.getByLabelText("Slug"));
    expect(props.onEdit).toHaveBeenLastCalledWith({ slug: "" });
  });

  it("saves the cover image when leaving the field, rejecting other schemes", async () => {
    const props = setup();
    const field = screen.getByLabelText("Ảnh bìa (URL)");
    await userEvent.type(field, "ftp://x");
    await userEvent.tab();
    expect(props.onSaveShared).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("/media/");
    await userEvent.clear(field);
    await userEvent.type(field, "https://blog.oki-dev.xyz/media/2026/a.webp");
    await userEvent.tab();
    expect(props.onSaveShared).toHaveBeenCalledWith({
      tags: [],
      coverImage: "https://blog.oki-dev.xyz/media/2026/a.webp",
    });
  });

  it("cannot delete the only version, and confirms deleting the post", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const props = setup();
    expect(screen.getByRole("button", { name: "Xoá bản vi" })).toHaveProperty("disabled", true);
    await userEvent.click(screen.getByRole("button", { name: "Xoá cả bài" }));
    expect(window.confirm).toHaveBeenCalled();
    expect(props.onDeletePost).toHaveBeenCalledOnce();
  });

  it("deletes one version of a bilingual post after confirming", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const props = setup(
      makePost({ versions: { vi: makeVersion(), ja: makeVersion({ title: "秋" }) } }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Xoá bản vi" }));
    expect(props.onDeleteVersion).toHaveBeenCalledOnce();
  });
});
