import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import { describe, expect, it } from "vitest";
import { BuildPipeline } from "../lib/constructs/build-pipeline";
import { repoRoot, testApp } from "./helpers";

const synth = () => {
  const stack = new Stack(testApp(), "Build", {
    env: { account: "111111111111", region: "ap-northeast-1" },
  });
  const siteBucket = new s3.Bucket(stack, "Site");
  new BuildPipeline(stack, "Build", {
    table: new dynamodb.TableV2(stack, "Table", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
    }),
    siteBucket,
    distribution: new cloudfront.Distribution(stack, "Dist", {
      defaultBehavior: { origin: S3BucketOrigin.withOriginAccessControl(siteBucket) },
    }),
    repoRoot,
  });
  return Template.fromStack(stack);
};

describe("BuildPipeline", () => {
  it("feeds a FIFO queue with a two-attempt DLQ into the build function", () => {
    const template = synth();
    template.hasResourceProperties("AWS::SQS::Queue", {
      FifoQueue: true,
      VisibilityTimeout: 1800,
      RedrivePolicy: Match.objectLike({ maxReceiveCount: 2 }),
    });
    template.hasResourceProperties("AWS::Lambda::EventSourceMapping", { BatchSize: 10 });
  });

  it("runs the build as an x86_64 container image with the planned limits", () => {
    synth().hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "blog-build",
      PackageType: "Image",
      Architectures: ["x86_64"],
      MemorySize: 2048,
      Timeout: 300,
      EphemeralStorage: { Size: 2048 },
      Environment: {
        Variables: Match.objectLike({
          TABLE_NAME: Match.anyValue(),
          SITE_BUCKET: Match.anyValue(),
          DISTRIBUTION_ID: Match.anyValue(),
        }),
      },
    });
  });

  it("logs to /aws/lambda/blog-build so the runbook can tail it", () => {
    synth().hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: "/aws/lambda/blog-build",
    });
  });

  it("keeps infra and e2e out of the image build context (no rebuild on infra edits)", () => {
    const ignored = readFileSync(join(repoRoot, ".dockerignore"), "utf8").split("\n");
    expect(ignored).toEqual(expect.arrayContaining(["infra", "e2e"]));
  });

  it("may invalidate and poll invalidations of the blog distribution", () => {
    synth().hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([Match.objectLike({ Action: "cloudfront:GetInvalidation" })]),
      },
    });
  });
});
