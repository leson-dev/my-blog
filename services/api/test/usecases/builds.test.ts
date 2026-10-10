import { describe, expect, it } from "vitest";
import { getLatestBuild, requestBuild } from "../../src/usecases/builds";
import { makeDeps } from "../fakes";

describe("requestBuild", () => {
  it("marks the build as queued and enqueues a message", async () => {
    const deps = makeDeps();
    await requestBuild(deps, "manual");
    expect(deps.buildQueue.reasons).toEqual(["manual"]);
    expect(await getLatestBuild(deps)).toEqual({
      status: "queued",
      updatedAt: deps.clock.now,
      error: null,
    });
  });

  it("marks the build as failed and rethrows when the queue is unavailable", async () => {
    const deps = makeDeps();
    deps.buildQueue.failWith = new Error("SQS down");
    await expect(requestBuild(deps, "manual")).rejects.toThrow("SQS down");
    expect(deps.builds.state).toMatchObject({
      status: "failed",
      error: "could not enqueue build: SQS down",
    });
  });
});
