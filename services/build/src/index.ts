import { Logger } from "@aws-lambda-powertools/logger";
import type { SQSEvent } from "aws-lambda";
import { loadConfig } from "./config";
import { createDeps } from "./deps";
import { type BuildDeps, runBuild } from "./runBuild";

const logger = new Logger({ serviceName: "blog-build" });
let deps: BuildDeps | undefined;

const reasonOf = (body: string): string => {
  try {
    return String((JSON.parse(body) as { reason?: unknown }).reason ?? "unknown");
  } catch {
    return "unknown";
  }
};

/**
 * SQS FIFO (one message group) delivers up to 10 requests per invocation: all of them are
 * satisfied by one build, because the build reads the latest data when it starts.
 * Throwing fails the whole batch so SQS retries it (then the DLQ).
 */
export async function handler(event: SQSEvent): Promise<void> {
  deps ??= createDeps(loadConfig(process.env), logger);
  logger.info("build requested", { reasons: event.Records.map((r) => reasonOf(r.body)) });
  const reference = event.Records.at(-1)?.messageId ?? deps.now();
  await runBuild(deps, reference);
}
