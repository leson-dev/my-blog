import type { BuildState } from "@blog/shared";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { errorMessage } from "../api/client";
import type { Endpoints } from "../api/endpoints";
import { useServices } from "../context";

export const BUILD_POLL_ACTIVE_MS = 5_000;
export const BUILD_POLL_IDLE_MS = 60_000;

export type BuildTone = "ok" | "busy" | "error" | "muted";

export function buildLabel(state: BuildState | null): { text: string; tone: BuildTone } {
  switch (state?.status) {
    case undefined:
      return { text: "● …", tone: "muted" };
    case "idle":
      return { text: "● chưa build", tone: "muted" };
    case "queued":
    case "running":
      return { text: "● đang build…", tone: "busy" };
    case "success":
      return { text: "● build ok", tone: "ok" };
    case "failed":
      return { text: "● lỗi", tone: "error" };
  }
}

export function useBuildStatus(api: Pick<Endpoints, "latestBuild" | "triggerBuild">) {
  const [state, setState] = useState<BuildState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await api.latestBuild());
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [api]);

  const rebuild = useCallback(async () => {
    try {
      setState(await api.triggerBuild());
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const active = state?.status === "queued" || state?.status === "running";
  useEffect(() => {
    const timer = setInterval(
      () => void refresh(),
      active ? BUILD_POLL_ACTIVE_MS : BUILD_POLL_IDLE_MS,
    );
    return () => clearInterval(timer);
  }, [active, refresh]);

  return { state, error, refresh, rebuild };
}

export type BuildStatus = ReturnType<typeof useBuildStatus>;

const BuildContext = createContext<BuildStatus | null>(null);

export function BuildProvider({ children }: { children: ReactNode }) {
  const { api } = useServices();
  const status = useBuildStatus(api);
  return <BuildContext.Provider value={status}>{children}</BuildContext.Provider>;
}

export function useBuild(): BuildStatus {
  const status = useContext(BuildContext);
  if (!status) throw new Error("BuildProvider is missing");
  return status;
}
