import { describe, expect, it } from "vitest";
import {
  loadZone,
  saveZone,
  scheduleLabel,
  shortScheduleLabel,
  utcToZonedInput,
  zonedInputToUtc,
} from "../../src/lib/zones";
import { MemoryStorage } from "../memoryStorage";

describe("zones", () => {
  it("turns a wall-clock time in VN or JP into UTC", () => {
    expect(zonedInputToUtc("2026-10-12T08:00", "jp")).toBe("2026-10-11T23:00:00.000Z");
    expect(zonedInputToUtc("2026-10-12T08:00", "vn")).toBe("2026-10-12T01:00:00.000Z");
  });

  it("turns UTC back into the datetime-local value of a zone", () => {
    expect(utcToZonedInput("2026-10-11T23:00:00.000Z", "jp")).toBe("2026-10-12T08:00");
    expect(utcToZonedInput("2026-10-11T23:00:00.000Z", "vn")).toBe("2026-10-12T06:00");
  });

  it("labels a schedule in the chosen zone with the other zone beside it", () => {
    expect(scheduleLabel("2026-10-11T23:00:00.000Z", "jp")).toBe(
      "2026-10-12 08:00 JST · 06:00 giờ VN",
    );
    expect(scheduleLabel("2026-10-11T23:00:00.000Z", "vn")).toBe(
      "2026-10-12 06:00 giờ VN · 08:00 JST",
    );
    expect(shortScheduleLabel("2026-10-11T23:00:00.000Z", "jp")).toBe("08:00 JST");
  });

  it("rejects malformed input", () => {
    expect(() => zonedInputToUtc("12/10/2026 08:00", "vn")).toThrow();
  });

  it("remembers the chosen zone, defaulting to VN", () => {
    const storage = new MemoryStorage();
    expect(loadZone(storage)).toBe("vn");
    saveZone("jp", storage);
    expect(loadZone(storage)).toBe("jp");
  });
});
