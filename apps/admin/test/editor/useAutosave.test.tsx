import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTOSAVE_DELAY_MS, useAutosave } from "../../src/editor/useAutosave";

describe("useAutosave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("saves 3 s after the last change, not before", () => {
    const save = vi.fn();
    const { rerender } = renderHook(({ rev }) => useAutosave(rev, true, save), {
      initialProps: { rev: 1 },
    });
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS - 1);
    rerender({ rev: 2 });
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS - 1);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledOnce();
    expect(AUTOSAVE_DELAY_MS).toBe(3_000);
  });

  it("does nothing while disabled", () => {
    const save = vi.fn();
    renderHook(() => useAutosave(1, false, save));
    vi.advanceTimersByTime(10_000);
    expect(save).not.toHaveBeenCalled();
  });

  it("flush saves a pending change at once, and only once", () => {
    const save = vi.fn();
    const { result } = renderHook(() => useAutosave(1, true, save));
    result.current();
    result.current();
    vi.advanceTimersByTime(10_000);
    expect(save).toHaveBeenCalledOnce();
  });

  it("saves a pending change when the editor goes away", () => {
    const save = vi.fn();
    const { unmount } = renderHook(() => useAutosave(1, true, save));
    unmount();
    expect(save).toHaveBeenCalledOnce();
  });
});
