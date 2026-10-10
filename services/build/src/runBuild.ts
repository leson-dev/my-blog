import type { BuildPhase } from "./status";
import type { SyncPlan } from "./syncSite";

const MAX_ERROR_LENGTH = 1000;

export interface BuildDeps {
  now(): string;
  status: { set(status: BuildPhase, now: string, error?: string | null): Promise<void> };
  /** Creates the writable directories the build needs. */
  prepare(): void;
  exportData(dir: string): Promise<{ posts: number; tags: number }>;
  buildSite(dataDir: string): Promise<string>;
  sync(distDir: string): Promise<SyncPlan>;
  invalidate(reference: string): Promise<void>;
  log: {
    info(message: string, attributes: Record<string, unknown>): void;
    error(message: string, attributes: Record<string, unknown>): void;
  };
  /** Where exportData writes and the site build reads; never the site fixtures. */
  dataDir: string;
}

/** One build. The S3 site is only touched after the site build succeeded. */
export async function runBuild(deps: BuildDeps, reference: string): Promise<void> {
  await deps.status.set("running", deps.now());
  try {
    deps.prepare();
    const counts = await deps.exportData(deps.dataDir);
    const distDir = await deps.buildSite(deps.dataDir);
    const plan = await deps.sync(distDir);
    await deps.invalidate(reference);
    await deps.status.set("success", deps.now());
    deps.log.info("build finished", {
      ...counts,
      uploaded: plan.assets.length + plan.pages.length,
      deleted: plan.deletes.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.log.error("build failed", { error: err });
    await deps.status.set("failed", deps.now(), message.slice(0, MAX_ERROR_LENGTH));
    throw err;
  }
}
