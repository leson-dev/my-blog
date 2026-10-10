import { Logger } from "@aws-lambda-powertools/logger";
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { loadConfig } from "./config";
import { createDeps } from "./deps";
import { isScheduledPublishEvent } from "./events";
import { handleHttp } from "./handlers/http/router";
import { handleScheduled } from "./handlers/scheduled";
import type { Deps } from "./usecases/ports";

const logger = new Logger({ serviceName: "blog-api" });
let deps: Deps | undefined;

export async function handler(event: unknown) {
  deps ??= createDeps(loadConfig(process.env));
  if (isScheduledPublishEvent(event)) {
    await handleScheduled(event, deps);
    return;
  }
  return handleHttp(event as APIGatewayProxyEventV2WithJWTAuthorizer, deps, logger);
}
