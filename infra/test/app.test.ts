import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { createStacks } from "../lib/app";
import { ADMIN_DIST_FIXTURE, repoRoot, testApp } from "./helpers";

describe("createStacks", () => {
  it("places the certificate in us-east-1 and the rest in the main region", () => {
    const app = testApp();
    const { cert, data, blog } = createStacks(app, repoRoot, ADMIN_DIST_FIXTURE);
    app.synth(); // cross-stack dependencies are resolved during synthesis
    expect([cert.stackName, cert.region]).toEqual(["BlogCert", "us-east-1"]);
    expect([data.stackName, data.region]).toEqual(["BlogData", "ap-northeast-1"]);
    expect([blog.stackName, blog.region]).toEqual(["Blog", "ap-northeast-1"]);
    expect(blog.dependencies.map((s) => s.stackName).sort()).toEqual(["BlogCert", "BlogData"]);
  });

  it("synthesizes the whole app without dependency cycles", () => {
    const app = testApp();
    createStacks(app, repoRoot, ADMIN_DIST_FIXTURE);
    expect(() => app.synth()).not.toThrow();
  });

  it("publishes config.json for the admin and the key outputs", () => {
    const template = Template.fromStack(createStacks(testApp(), repoRoot, ADMIN_DIST_FIXTURE).blog);
    template.hasResourceProperties("Custom::CDKBucketDeployment", { Prune: false });
    for (const name of [
      "BlogUrl",
      "AdminUrl",
      "ApiUrl",
      "BuildQueueUrl",
      "UserPoolId",
      "SiteBucketName",
    ]) {
      template.hasOutput(name, Match.anyValue());
    }
  });
  it("deploys the admin build: hashed assets immutable, shell and config.json no-cache", () => {
    const app = testApp();
    const { blog } = createStacks(app, repoRoot, ADMIN_DIST_FIXTURE);
    const template = Template.fromStack(blog);
    template.hasResourceProperties("Custom::CDKBucketDeployment", {
      DestinationBucketKeyPrefix: "assets/",
      SystemMetadata: { "cache-control": "public, max-age=31536000, immutable" },
      Prune: false,
    });
    template.hasResourceProperties("Custom::CDKBucketDeployment", {
      SystemMetadata: { "cache-control": "no-cache" },
      DistributionPaths: ["/*"],
      Prune: false,
    });
  });

  it("explains how to build the admin app when its dist is missing", () => {
    expect(() => createStacks(testApp(), repoRoot, "/nonexistent/admin-dist")).toThrow(
      "pnpm --filter @blog/admin build",
    );
  });
});
