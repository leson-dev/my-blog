import type { Lang, LangVersion } from "@blog/shared";
import { shortScheduleLabel, type ZoneKey } from "./zones";

export type PublishAction =
  | "publish"
  | "schedule"
  | "publishNow"
  | "unschedule"
  | "update"
  | "unpublish";

export interface PublishMenu {
  primary: { label: string; action: PublishAction };
  menu: Array<{ label: string; action: PublishAction }>;
}

/** The publish button for the open tab (spec ui-i18n 4.4). */
export function publishMenu(lang: Lang, version: LangVersion, zone: ZoneKey): PublishMenu {
  switch (version.status) {
    case "draft":
      return {
        primary: { label: `Đăng bản ${lang}`, action: "publish" },
        menu: [{ label: "Hẹn giờ…", action: "schedule" }],
      };
    case "scheduled":
      return {
        primary: {
          label: version.publishAt
            ? `Hẹn ${shortScheduleLabel(version.publishAt, zone)}`
            : "Hẹn giờ",
          action: "schedule",
        },
        menu: [
          { label: "Đổi giờ…", action: "schedule" },
          { label: "Đăng ngay", action: "publishNow" },
          { label: "Huỷ hẹn", action: "unschedule" },
        ],
      };
    case "published":
      return {
        primary: { label: `Cập nhật bản ${lang}`, action: "update" },
        menu: [{ label: "Gỡ bài", action: "unpublish" }],
      };
  }
}
