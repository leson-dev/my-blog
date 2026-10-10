import { describe, expect, it, vi } from "vitest";
import { type BuildDeps, runBuild } from "../src/runBuild";

const makeDeps = (overrides: Partial<BuildDeps> = {}) => {
  const events: string[] = [];
  const statuses: Array<{ status: string; error: string | null | undefined }> = [];
  const deps: BuildDeps = {
    now: () => "2026-10-10T00:00:00.000Z",
    status: {
      set: async (status, _now, error) => {
        statuses.push({ status, error });
        events.push(`status:${status}`);
      },
    },
    prepare: () => events.push("prepare"),
    exportData: async () => {
      events.push("export");
      return { posts: 5, tags: 1 };
    },
    buildSite: async (dataDir) => {
      events.push(`build:${dataDir}`);
      return "/tmp/site-dist";
    },
    sync: async () => {
      events.push("sync");
      return { assets: ["a.css"], pages: ["index.html"], deletes: [] };
    },
    invalidate: async (reference) => {
      events.push(`invalidate:${reference}`);
    },
    log: { info: vi.fn(), error: vi.fn() },
    dataDir: "/tmp/site-data",
    ...overrides,
  };
  return { deps, events, statuses };
};

describe("runBuild", () => {
  it("runs every step in order and reports success", async () => {
    const { deps, events } = makeDeps();
    await runBuild(deps, "msg-1");
    expect(events).toEqual([
      "status:running",
      "prepare",
      "export",
      "build:/tmp/site-data",
      "sync",
      "invalidate:msg-1",
      "status:success",
    ]);
  });

  it("records the failure, keeps the old site and rethrows when the site build fails", async () => {
    const { deps, events, statuses } = makeDeps({
      buildSite: async () => {
        throw new Error(
          "Command failed: astro build\n[ERROR] invalid site data in /tmp/site-data/posts.json",
        );
      },
    });
    await expect(runBuild(deps, "msg-1")).rejects.toThrow("Command failed");
    expect(events).not.toContain("sync");
    expect(events.some((e) => e.startsWith("invalidate"))).toBe(false);
    expect(statuses.at(-1)?.status).toBe("failed");
    expect(statuses.at(-1)?.error).toContain("invalid site data");
  });

  it("truncates very long error messages", async () => {
    const { deps, statuses } = makeDeps({
      sync: async () => {
        throw new Error("x".repeat(5000));
      },
    });
    await expect(runBuild(deps, "m")).rejects.toThrow();
    expect(statuses.at(-1)?.error).toHaveLength(1000);
  });
});
