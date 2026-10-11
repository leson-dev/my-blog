import type { KeyValueStore } from "../auth/session";

/** Neither zone observes daylight saving time, so fixed offsets are exact. */
export const ZONES = {
  vn: {
    id: "Asia/Ho_Chi_Minh",
    short: "giờ VN",
    label: "Giờ Việt Nam (UTC+7)",
    offsetMinutes: 7 * 60,
  },
  jp: { id: "Asia/Tokyo", short: "JST", label: "Giờ Nhật (UTC+9)", offsetMinutes: 9 * 60 },
} as const;
export type ZoneKey = keyof typeof ZONES;

const other = (zone: ZoneKey): ZoneKey => (zone === "vn" ? "jp" : "vn");
const pad = (n: number) => String(n).padStart(2, "0");

function wallClock(iso: string, zone: ZoneKey): { date: string; time: string } {
  const d = new Date(Date.parse(iso) + ZONES[zone].offsetMinutes * 60_000);
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}

/** `<input type="datetime-local">` value ("YYYY-MM-DDTHH:mm") in `zone` → UTC ISO. */
export function zonedInputToUtc(local: string, zone: ZoneKey): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) throw new Error(`invalid datetime-local value: ${local}`);
  const [y, mo, d, h, mi] = match.slice(1).map(Number) as [number, number, number, number, number];
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - ZONES[zone].offsetMinutes * 60_000).toISOString();
}

export function utcToZonedInput(iso: string, zone: ZoneKey): string {
  const { date, time } = wallClock(iso, zone);
  return `${date}T${time}`;
}

/** "2026-10-12 08:00 JST · 06:00 giờ VN" */
export function scheduleLabel(iso: string, zone: ZoneKey): string {
  const a = wallClock(iso, zone);
  const b = wallClock(iso, other(zone));
  return `${a.date} ${a.time} ${ZONES[zone].short} · ${b.time} ${ZONES[other(zone)].short}`;
}

/** "08:00 JST" */
export function shortScheduleLabel(iso: string, zone: ZoneKey): string {
  return `${wallClock(iso, zone).time} ${ZONES[zone].short}`;
}

const ZONE_KEY = "oki-admin:zone";

export function loadZone(storage: Pick<KeyValueStore, "getItem"> = localStorage): ZoneKey {
  try {
    const value = storage.getItem(ZONE_KEY);
    return value === "vn" || value === "jp" ? value : "vn";
  } catch {
    return "vn";
  }
}

export function saveZone(
  zone: ZoneKey,
  storage: Pick<KeyValueStore, "setItem"> = localStorage,
): void {
  try {
    storage.setItem(ZONE_KEY, zone);
  } catch {
    // Storage unavailable (private mode): the choice is simply not remembered.
  }
}
