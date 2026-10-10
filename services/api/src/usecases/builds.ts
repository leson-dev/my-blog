import type { BuildState } from "@blog/shared";
import type { Deps } from "./ports";

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export async function requestBuild(deps: Deps, reason: string): Promise<void> {
  const now = deps.now();
  await deps.builds.setQueued(now);
  try {
    await deps.buildQueue.enqueue(reason);
  } catch (err) {
    await deps.builds.setFailed(now, `could not enqueue build: ${messageOf(err)}`);
    throw err;
  }
}

export const getLatestBuild = (deps: Deps): Promise<BuildState> => deps.builds.get();

export const triggerBuild = (deps: Deps): Promise<void> => requestBuild(deps, "manual");
