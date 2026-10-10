import { randomUUID } from "node:crypto";
import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import type { BuildQueue } from "../../usecases/ports";

export class SqsBuildQueue implements BuildQueue {
  private readonly sqs: SQSClient;
  private readonly queueUrl: string;

  constructor(sqs: SQSClient, queueUrl: string) {
    this.sqs = sqs;
    this.queueUrl = queueUrl;
  }

  async enqueue(reason: string): Promise<void> {
    await this.sqs.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify({ reason }),
        // One group => builds run strictly one at a time.
        MessageGroupId: "site",
        // Random id => identical requests within 5 minutes are not swallowed.
        MessageDeduplicationId: randomUUID(),
      }),
    );
  }
}
