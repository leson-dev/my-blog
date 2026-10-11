import { describe, expect, it } from "vitest";
import { formatClock, formatLocal } from "../src/lib/format";

describe("format", () => {
  it("shows an instant in the browser's time zone", () => {
    const iso = new Date(2026, 9, 12, 8, 5).toISOString();
    expect(formatLocal(iso)).toBe("2026-10-12 08:05");
    expect(formatClock(iso)).toBe("08:05");
  });
});
