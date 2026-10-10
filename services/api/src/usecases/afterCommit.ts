import type { Deps } from "./ports";

/**
 * Runs a side effect that follows an already committed write (cancel a schedule, queue a build).
 * Failures are logged instead of thrown: the write stands, a stale schedule is skipped when it
 * fires, and a failed build request is already visible as build status "failed".
 */
export async function afterCommit(deps: Deps, what: string, effect: () => Promise<void>) {
  try {
    await effect();
  } catch (error) {
    deps.log.error(`${what} failed after the post was saved`, { error });
  }
}
