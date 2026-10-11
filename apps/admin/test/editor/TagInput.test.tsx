import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TagInput } from "../../src/editor/TagInput";

const known = [{ key: "doi-song", names: { vi: "Đời sống", ja: "暮らし" }, postCount: 3 }];

function setup(value: string[] = []) {
  const onChange = vi.fn();
  const onCreateTag = vi.fn(async () => {});
  render(<TagInput value={value} known={known} onChange={onChange} onCreateTag={onCreateTag} />);
  return { onChange, onCreateTag };
}

describe("TagInput", () => {
  it("adds a known tag by its normalized key", async () => {
    const { onChange, onCreateTag } = setup(["aws"]);
    await userEvent.type(screen.getByLabelText("Thêm tag"), "Đời sống{Enter}");
    expect(onChange).toHaveBeenCalledWith(["aws", "doi-song"]);
    expect(onCreateTag).not.toHaveBeenCalled();
  });

  it("asks for vi/ja names before adding a new tag", async () => {
    const { onChange, onCreateTag } = setup();
    await userEvent.type(screen.getByLabelText("Thêm tag"), "Du lịch{Enter}");
    expect(screen.getByLabelText("Tên vi")).toHaveProperty("value", "Du lịch");
    await userEvent.type(screen.getByLabelText("Tên ja"), "旅行");
    await userEvent.click(screen.getByRole("button", { name: "Thêm tag mới" }));
    expect(onCreateTag).toHaveBeenCalledWith("du-lich", { vi: "Du lịch", ja: "旅行" });
    expect(onChange).toHaveBeenCalledWith(["du-lich"]);
  });

  it("removes a tag", async () => {
    const { onChange } = setup(["aws", "doi-song"]);
    await userEvent.click(screen.getByRole("button", { name: "Bỏ tag Đời sống" }));
    expect(onChange).toHaveBeenCalledWith(["aws"]);
  });

  it("ignores input without latin letters or digits", async () => {
    const { onChange } = setup();
    await userEvent.type(screen.getByLabelText("Thêm tag"), "旅{Enter}");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("chữ Latin");
  });
});
