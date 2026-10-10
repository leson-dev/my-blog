import {
  ConflictException,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  ResourceNotFoundException,
  SchedulerClient,
  UpdateScheduleCommand,
} from "@aws-sdk/client-scheduler";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import {
  atExpression,
  EventBridgePublishScheduler,
} from "../../src/adapters/scheduler/publishScheduler";

const client = mockClient(SchedulerClient);
const scheduler = new EventBridgePublishScheduler(
  new SchedulerClient({ region: "ap-northeast-1" }),
  {
    groupName: "blog-publish",
    lambdaArn: "arn:aws:lambda:ap-northeast-1:111111111111:function:api",
    roleArn: "arn:aws:iam::111111111111:role/scheduler",
  },
);

beforeEach(() => client.reset());

describe("atExpression", () => {
  it("formats a UTC ISO timestamp without milliseconds or zone", () => {
    expect(atExpression("2026-10-12T08:00:00.000Z")).toBe("at(2026-10-12T08:00:00)");
  });
});

describe("EventBridgePublishScheduler.schedule", () => {
  it("creates a one-time, self-deleting schedule that carries the publish event", async () => {
    client.on(CreateScheduleCommand).resolves({});
    await scheduler.schedule("P1", "2026-10-12T08:00:00.000Z");
    const input = client.commandCalls(CreateScheduleCommand)[0]?.args[0].input;
    expect(input).toMatchObject({
      Name: "post-P1",
      GroupName: "blog-publish",
      ScheduleExpression: "at(2026-10-12T08:00:00)",
      ScheduleExpressionTimezone: "UTC",
      FlexibleTimeWindow: { Mode: "OFF" },
      ActionAfterCompletion: "DELETE",
    });
    expect(JSON.parse(input?.Target?.Input ?? "{}")).toEqual({
      type: "scheduled-publish",
      postId: "P1",
      publishAt: "2026-10-12T08:00:00.000Z",
    });
  });

  it("updates the schedule when it already exists", async () => {
    client
      .on(CreateScheduleCommand)
      .rejects(new ConflictException({ message: "exists", $metadata: {} }));
    client.on(UpdateScheduleCommand).resolves({});
    await scheduler.schedule("P1", "2026-10-13T08:00:00.000Z");
    expect(client.commandCalls(UpdateScheduleCommand)[0]?.args[0].input.ScheduleExpression).toBe(
      "at(2026-10-13T08:00:00)",
    );
  });
});

describe("EventBridgePublishScheduler.cancel", () => {
  it("deletes the schedule", async () => {
    client.on(DeleteScheduleCommand).resolves({});
    await scheduler.cancel("P1");
    expect(client.commandCalls(DeleteScheduleCommand)[0]?.args[0].input).toEqual({
      Name: "post-P1",
      GroupName: "blog-publish",
    });
  });

  it("succeeds when the schedule is already gone", async () => {
    client
      .on(DeleteScheduleCommand)
      .rejects(new ResourceNotFoundException({ message: "gone", $metadata: {} }));
    await expect(scheduler.cancel("P1")).resolves.toBeUndefined();
  });
});
