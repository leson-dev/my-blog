import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TagsPage } from "../../src/pages/TagsPage";
import { fakeApi, renderWithServices } from "../render";

const tags = [
  { key: "doi-song", names: { vi: "Đời sống" }, postCount: 2 },
  { key: "aws", names: {}, postCount: 5 },
];

function setup() {
  const putTag = vi.fn(async (key: string, names: object) => ({ key, names }));
  renderWithServices(<TagsPage />, fakeApi({ listTags: vi.fn(async () => tags), putTag }));
  return { putTag };
}

describe("TagsPage", () => {
  it("lists tags by key with their names and post counts", async () => {
    setup();
    const keys = await screen.findAllByRole("rowheader");
    expect(keys.map((k) => k.textContent)).toEqual(["aws", "doi-song"]);
    expect(screen.getByLabelText("Tên vi của doi-song")).toHaveProperty("value", "Đời sống");
    expect(screen.getByText("5")).toBeTruthy();
  });

  it("saves a renamed tag when leaving the field, dropping empty names", async () => {
    const { putTag } = setup();
    const ja = await screen.findByLabelText("Tên ja của doi-song");
    await userEvent.type(ja, "暮らし");
    await userEvent.tab();
    await waitFor(() =>
      expect(putTag).toHaveBeenCalledWith("doi-song", { vi: "Đời sống", ja: "暮らし" }),
    );
    expect(await screen.findByText("đã lưu")).toBeTruthy();
  });

  it("does not save an unchanged row", async () => {
    const { putTag } = setup();
    await userEvent.click(await screen.findByLabelText("Tên vi của aws"));
    await userEvent.tab();
    expect(putTag).not.toHaveBeenCalled();
  });
});
