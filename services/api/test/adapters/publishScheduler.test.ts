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
  scheduleName,
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

describe("naming and expressions", () => {
  it("names schedules per post and language", () => {
    expect(scheduleName("P1", "ja")).toBe("post-P1-ja");
  });

  it("formats a UTC ISO timestamp as an at() expression", () => {
    expect(atExpression("2026-10-12T08:00:00.000Z")).toBe("at(2026-10-12T08:00:00)");
  });
});

describe("schedule", () => {
  it("creates a self-deleting schedule carrying the language", async () => {
    client.on(CreateScheduleCommand).resolves({});
    await scheduler.schedule("P1", "ja", "2026-10-12T08:00:00.000Z");
    const input = client.commandCalls(CreateScheduleCommand)[0]?.args[0].input;
    expect(input).toMatchObject({
      Name: "post-P1-ja",
      GroupName: "blog-publish",
      ScheduleExpression: "at(2026-10-12T08:00:00)",
      ScheduleExpressionTimezone: "UTC",
      ActionAfterCompletion: "DELETE",
    });
    expect(JSON.parse(input?.Target?.Input ?? "{}")).toEqual({
      type: "scheduled-publish",
      postId: "P1",
      lang: "ja",
      publishAt: "2026-10-12T08:00:00.000Z",
    });
  });

  it("updates an existing schedule", async () => {
    client
      .on(CreateScheduleCommand)
      .rejects(new ConflictException({ message: "exists", Message: "exists", $metadata: {} }));
    client.on(UpdateScheduleCommand).resolves({});
    await scheduler.schedule("P1", "vi", "2026-10-13T08:00:00.000Z");
    expect(client.commandCalls(UpdateScheduleCommand)[0]?.args[0].input.Name).toBe("post-P1-vi");
  });
});

describe("cancel", () => {
  it("deletes the schedule of one language", async () => {
    client.on(DeleteScheduleCommand).resolves({});
    await scheduler.cancel("P1", "ja");
    expect(client.commandCalls(DeleteScheduleCommand)[0]?.args[0].input).toEqual({
      Name: "post-P1-ja",
      GroupName: "blog-publish",
    });
  });

  it("succeeds when the schedule is already gone", async () => {
    client
      .on(DeleteScheduleCommand)
      .rejects(new ResourceNotFoundException({ message: "gone", Message: "gone", $metadata: {} }));
    await expect(scheduler.cancel("P1", "vi")).resolves.toBeUndefined();
  });
});
