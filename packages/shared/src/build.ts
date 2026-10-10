export const BUILD_STATUSES = ["idle", "queued", "running", "success", "failed"] as const;
export type BuildStatus = (typeof BUILD_STATUSES)[number];

export interface BuildState {
  status: BuildStatus;
  updatedAt: string | null;
  error: string | null;
}
