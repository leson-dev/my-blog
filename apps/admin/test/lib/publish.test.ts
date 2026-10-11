import { describe, expect, it } from "vitest";
import { publishMenu } from "../../src/lib/publish";
import { makeVersion } from "../fixtures";

describe("publishMenu (spec ui-i18n 4.4)", () => {
  it("draft: publish, or schedule from the menu", () => {
    expect(publishMenu("vi", makeVersion({ status: "draft" }), "vn")).toEqual({
      primary: { label: "Đăng bản vi", action: "publish" },
      menu: [{ label: "Hẹn giờ…", action: "schedule" }],
    });
  });

  it("scheduled: shows the time; change, publish now or cancel", () => {
    const v = makeVersion({ status: "scheduled", publishAt: "2026-10-11T23:00:00.000Z" });
    expect(publishMenu("ja", v, "jp")).toEqual({
      primary: { label: "Hẹn 08:00 JST", action: "schedule" },
      menu: [
        { label: "Đổi giờ…", action: "schedule" },
        { label: "Đăng ngay", action: "publishNow" },
        { label: "Huỷ hẹn", action: "unschedule" },
      ],
    });
  });

  it("published: update, or take it down", () => {
    expect(publishMenu("vi", makeVersion({ status: "published" }), "vn")).toEqual({
      primary: { label: "Cập nhật bản vi", action: "update" },
      menu: [{ label: "Gỡ bài", action: "unpublish" }],
    });
  });
});
