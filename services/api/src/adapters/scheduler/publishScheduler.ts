import {
  ConflictException,
  CreateScheduleCommand,
  type CreateScheduleCommandInput,
  DeleteScheduleCommand,
  ResourceNotFoundException,
  type SchedulerClient,
  UpdateScheduleCommand,
} from "@aws-sdk/client-scheduler";
import type { Lang } from "@blog/shared";
import type { ScheduledPublishEvent } from "../../events";
import type { PublishScheduler } from "../../usecases/ports";

export interface SchedulerTarget {
  groupName: string;
  lambdaArn: string;
  roleArn: string;
}

export const scheduleName = (postId: string, lang: Lang) => `post-${postId}-${lang}`;

/** "2026-10-12T08:00:00.000Z" -> "at(2026-10-12T08:00:00)" (interpreted in UTC). */
export const atExpression = (iso: string) => `at(${iso.slice(0, 19)})`;

export class EventBridgePublishScheduler implements PublishScheduler {
  private readonly client: SchedulerClient;
  private readonly target: SchedulerTarget;

  constructor(client: SchedulerClient, target: SchedulerTarget) {
    this.client = client;
    this.target = target;
  }

  async schedule(postId: string, lang: Lang, publishAt: string): Promise<void> {
    const event: ScheduledPublishEvent = { type: "scheduled-publish", postId, lang, publishAt };
    const input: CreateScheduleCommandInput = {
      Name: scheduleName(postId, lang),
      GroupName: this.target.groupName,
      ScheduleExpression: atExpression(publishAt),
      ScheduleExpressionTimezone: "UTC",
      FlexibleTimeWindow: { Mode: "OFF" },
      ActionAfterCompletion: "DELETE",
      Target: {
        Arn: this.target.lambdaArn,
        RoleArn: this.target.roleArn,
        Input: JSON.stringify(event),
      },
    };
    try {
      await this.client.send(new CreateScheduleCommand(input));
    } catch (err) {
      if (!(err instanceof ConflictException)) throw err;
      await this.client.send(new UpdateScheduleCommand(input));
    }
  }

  async cancel(postId: string, lang: Lang): Promise<void> {
    try {
      await this.client.send(
        new DeleteScheduleCommand({
          Name: scheduleName(postId, lang),
          GroupName: this.target.groupName,
        }),
      );
    } catch (err) {
      if (err instanceof ResourceNotFoundException) return;
      throw err;
    }
  }
}
