import { Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { describe, it } from "vitest";
import { Monitoring } from "../lib/constructs/monitoring";
import { testApp } from "./helpers";

const synth = () => {
  const stack = new Stack(testApp(), "Mon", {
    env: { account: "111111111111", region: "ap-northeast-1" },
  });
  const fn = (id: string) =>
    new lambda.Function(stack, id, {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: "index.handler",
      code: lambda.Code.fromInline("exports.handler = async () => {}"),
    });
  new Monitoring(stack, "Monitoring", {
    alertEmail: "alerts@example.dev",
    apiFn: fn("Api"),
    buildFn: fn("Build"),
    dlq: new sqs.Queue(stack, "Dlq", { fifo: true }),
  });
  return Template.fromStack(stack);
};

describe("Monitoring", () => {
  it("emails alerts through SNS", () => {
    synth().hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "email",
      Endpoint: "alerts@example.dev",
    });
  });

  it("alarms on a dead-lettered build, API errors and build errors, also notifying recovery", () => {
    const template = synth();
    template.resourceCountIs("AWS::CloudWatch::Alarm", 3);
    template.allResourcesProperties("AWS::CloudWatch::Alarm", {
      AlarmActions: [Match.anyValue()],
      OKActions: [Match.anyValue()],
      TreatMissingData: "notBreaching",
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "ApproximateNumberOfMessagesVisible",
      Threshold: 1,
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "Errors",
      Threshold: 5,
    });
  });

  it("warns when the monthly forecast exceeds 5 USD", () => {
    synth().hasResourceProperties("AWS::Budgets::Budget", {
      Budget: Match.objectLike({ BudgetLimit: { Amount: 5, Unit: "USD" }, TimeUnit: "MONTHLY" }),
      NotificationsWithSubscribers: [
        Match.objectLike({
          Notification: Match.objectLike({ NotificationType: "FORECASTED", Threshold: 100 }),
          Subscribers: [{ SubscriptionType: "EMAIL", Address: "alerts@example.dev" }],
        }),
      ],
    });
  });
});
