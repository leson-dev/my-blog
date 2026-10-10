import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { createStacks } from "../lib/app";
import { repoRoot, testApp } from "./helpers";

describe("createStacks", () => {
  it("places the certificate in us-east-1 and the rest in the main region", () => {
    const app = testApp();
    const { cert, data, blog } = createStacks(app, repoRoot);
    app.synth(); // cross-stack dependencies are resolved during synthesis
    expect([cert.stackName, cert.region]).toEqual(["BlogCert", "us-east-1"]);
    expect([data.stackName, data.region]).toEqual(["BlogData", "ap-northeast-1"]);
    expect([blog.stackName, blog.region]).toEqual(["Blog", "ap-northeast-1"]);
    expect(blog.dependencies.map((s) => s.stackName).sort()).toEqual(["BlogCert", "BlogData"]);
  });

  it("synthesizes the whole app without dependency cycles", () => {
    const app = testApp();
    createStacks(app, repoRoot);
    expect(() => app.synth()).not.toThrow();
  });

  it("publishes config.json for the admin and the key outputs", () => {
    const template = Template.fromStack(createStacks(testApp(), repoRoot).blog);
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
});
