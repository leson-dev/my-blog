import { Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { describe, expect, it } from "vitest";
import { readConfig } from "../lib/config";
import { API_ROUTES, ApiService } from "../lib/constructs/api-service";
import { repoRoot, testApp } from "./helpers";

const synth = () => {
  const app = testApp();
  const stack = new Stack(app, "Api", {
    env: { account: "111111111111", region: "ap-northeast-1" },
  });
  const userPool = new cognito.UserPool(stack, "Pool");
  new ApiService(stack, "Api", {
    config: readConfig(app),
    zone: route53.HostedZone.fromHostedZoneAttributes(stack, "Zone", {
      hostedZoneId: "ZTEST123",
      zoneName: "example.dev",
    }),
    table: new dynamodb.TableV2(stack, "Table", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
    }),
    mediaBucket: new s3.Bucket(stack, "Media"),
    buildQueue: new sqs.Queue(stack, "Queue", { fifo: true }),
    userPool,
    userPoolClient: userPool.addClient("Client"),
    repoRoot,
  });
  return Template.fromStack(stack);
};

describe("ApiService", () => {
  it("runs the API on Node 24 / arm64 with the environment services/api expects", () => {
    synth().hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "blog-api",
      Runtime: "nodejs24.x",
      Architectures: ["arm64"],
      Environment: {
        Variables: Match.objectLike({
          TABLE_NAME: Match.anyValue(),
          BUILD_QUEUE_URL: Match.anyValue(),
          MEDIA_BUCKET: Match.anyValue(),
          BLOG_BASE_URL: "https://blog.example.dev",
          SCHEDULER_GROUP: "blog-publish",
          SCHEDULER_TARGET_ARN: Match.anyValue(),
          SCHEDULER_ROLE_ARN: Match.anyValue(),
        }),
      },
    });
  });

  it("protects every planned route with the Cognito JWT authorizer", () => {
    const template = synth();
    expect(API_ROUTES).toHaveLength(14);
    for (const routeKey of API_ROUTES) {
      template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
        RouteKey: routeKey,
        AuthorizationType: "JWT",
      });
    }
  });

  it("throttles, restricts CORS to the admin origins and serves api.<domain>", () => {
    const template = synth();
    template.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      StageName: "$default",
      DefaultRouteSettings: Match.objectLike({ ThrottlingRateLimit: 20, ThrottlingBurstLimit: 40 }),
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Api", {
      CorsConfiguration: Match.objectLike({
        AllowOrigins: ["https://admin.example.dev", "http://localhost:5173"],
      }),
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::DomainName", {
      DomainName: "api.example.dev",
    });
    template.hasResourceProperties("AWS::Route53::RecordSet", {
      Name: "api.example.dev.",
      Type: "A",
    });
  });

  it("lets the API manage schedules only in its group and pass only the scheduler role", () => {
    const template = synth();
    template.hasResourceProperties("AWS::Scheduler::ScheduleGroup", { Name: "blog-publish" });
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: [
              "scheduler:CreateSchedule",
              "scheduler:UpdateSchedule",
              "scheduler:DeleteSchedule",
            ],
          }),
          Match.objectLike({ Action: "iam:PassRole" }),
        ]),
      },
    });
    // ARNs contain the ${AWS::Partition} token, so check the serialized template.
    const json = JSON.stringify(template.toJSON());
    expect(json).toContain(":scheduler:ap-northeast-1:111111111111:schedule/blog-publish/*");
    expect(json).toContain(":lambda:ap-northeast-1:111111111111:function:blog-api");
    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Principal: { Service: "scheduler.amazonaws.com" },
            Condition: { StringEquals: { "aws:SourceAccount": "111111111111" } },
          }),
        ],
      },
    });
  });
});
