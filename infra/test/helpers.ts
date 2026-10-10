import { resolve } from "node:path";
import { App } from "aws-cdk-lib";

export const repoRoot = resolve(import.meta.dirname, "../..");

export const TEST_CONTEXT = {
  account: "111111111111",
  region: "ap-northeast-1",
  domainName: "example.dev",
  hostedZoneId: "ZTEST123",
  alertEmail: "alerts@example.dev",
  adminDevOrigin: "http://localhost:5173",
};

/** An app with test context; Lambda bundling is skipped to keep synth fast. */
export const testApp = (context: Record<string, string> = TEST_CONTEXT) =>
  new App({ context: { ...context, "aws:cdk:bundling-stacks": [] } });
