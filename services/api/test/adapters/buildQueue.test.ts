import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { SqsBuildQueue } from "../../src/adapters/sqs/buildQueue";

const sqs = mockClient(SQSClient);
const queue = new SqsBuildQueue(new SQSClient({ region: "ap-northeast-1" }), "https://sqs/q.fifo");

beforeEach(() => sqs.reset());

describe("SqsBuildQueue", () => {
  it("sends to the single 'site' group with a unique dedup id per request", async () => {
    sqs.on(SendMessageCommand).resolves({});
    await queue.enqueue("manual");
    await queue.enqueue("manual");
    const [a, b] = sqs.commandCalls(SendMessageCommand).map((c) => c.args[0].input);
    expect(a).toMatchObject({
      QueueUrl: "https://sqs/q.fifo",
      MessageGroupId: "site",
      MessageBody: JSON.stringify({ reason: "manual" }),
    });
    expect(a?.MessageDeduplicationId).toBeTruthy();
    expect(a?.MessageDeduplicationId).not.toBe(b?.MessageDeduplicationId);
  });
});
