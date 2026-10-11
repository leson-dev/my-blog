import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ScheduleDialog } from "../../src/editor/ScheduleDialog";

const NOW = Date.parse("2026-10-11T00:00:00.000Z");

function setup(zone: "vn" | "jp" = "jp") {
  const props = {
    lang: "vi" as const,
    initialIso: "2026-10-11T23:00:00.000Z",
    zone,
    onZoneChange: vi.fn(),
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    now: () => NOW,
  };
  render(<ScheduleDialog {...props} />);
  return props;
}

describe("ScheduleDialog", () => {
  it("shows the chosen time in both zones and submits UTC", async () => {
    const props = setup("jp");
    expect(screen.getByLabelText("Thời điểm")).toHaveProperty("value", "2026-10-12T08:00");
    expect(screen.getByText("2026-10-12 08:00 JST · 06:00 giờ VN")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Hẹn giờ" }));
    expect(props.onSubmit).toHaveBeenCalledWith("2026-10-11T23:00:00.000Z");
  });

  it("keeps the wall-clock time when the zone changes", async () => {
    const props = setup("jp");
    await userEvent.selectOptions(screen.getByLabelText("Múi giờ"), "vn");
    expect(props.onZoneChange).toHaveBeenCalledWith("vn");
  });

  it("refuses a time less than 2 minutes ahead", async () => {
    const props = setup("vn");
    const field = screen.getByLabelText("Thời điểm");
    await userEvent.clear(field);
    await userEvent.type(field, "2026-10-11T07:01");
    expect(screen.getByRole("alert").textContent).toContain("ít nhất 2 phút");
    expect(screen.getByRole("button", { name: "Hẹn giờ" })).toHaveProperty("disabled", true);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
});
