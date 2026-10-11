import type { BuildState, BuildStatus } from "@blog/shared";
import { act, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLabel, useBuildStatus } from "../src/build/BuildProvider";
import { Layout } from "../src/components/Layout";
import { fakeApi, renderWithServices } from "./render";

const state = (status: BuildStatus): BuildState => ({ status, updatedAt: null, error: null });

describe("buildLabel", () => {
  it.each([
    [null, "● …", "muted"],
    ["idle", "● chưa build", "muted"],
    ["queued", "● đang build…", "busy"],
    ["running", "● đang build…", "busy"],
    ["success", "● build ok", "ok"],
    ["failed", "● lỗi", "error"],
  ] as const)("%s", (status, text, tone) => {
    expect(buildLabel(status === null ? null : state(status))).toEqual({ text, tone });
  });
});

describe("useBuildStatus", () => {
  afterEach(() => vi.useRealTimers());

  it("polls every 5 s while a build runs and every 60 s otherwise", async () => {
    vi.useFakeTimers();
    const latestBuild = vi
      .fn()
      .mockResolvedValueOnce(state("running"))
      .mockResolvedValue(state("success"));
    const api = fakeApi({ latestBuild });
    const { result } = renderHook(() => useBuildStatus(api));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.state?.status).toBe("running");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(latestBuild).toHaveBeenCalledTimes(2);
    expect(result.current.state?.status).toBe("success");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(latestBuild).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(55_000);
    });
    expect(latestBuild).toHaveBeenCalledTimes(3);
  });
});

describe("Layout", () => {
  it("shows the build state and rebuilds on request", async () => {
    const { api } = renderWithServices(<Layout crumbs={[{ label: "bài viết" }]}>nội dung</Layout>);
    expect(await screen.findByText("● build ok")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Build lại" }));
    expect(api.triggerBuild).toHaveBeenCalledOnce();
    expect(await screen.findByText("● đang build…")).toBeTruthy();
  });

  it("logs out", async () => {
    const { services } = renderWithServices(<Layout>x</Layout>);
    await userEvent.click(screen.getByRole("button", { name: "đăng xuất" }));
    expect(services.auth.logout).toHaveBeenCalledOnce();
  });
});
