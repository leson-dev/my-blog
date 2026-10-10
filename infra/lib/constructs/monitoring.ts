import { Duration } from "aws-cdk-lib";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import type * as lambda from "aws-cdk-lib/aws-lambda";
import * as sns from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import type * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

export interface MonitoringProps {
  alertEmail: string;
  apiFn: lambda.IFunction;
  buildFn: lambda.IFunction;
  dlq: sqs.IQueue;
}

/** Alarms → SNS → email (spec 5.3); Discord was dropped for now. */
export class Monitoring extends Construct {
  constructor(scope: Construct, id: string, props: MonitoringProps) {
    super(scope, id);

    const topic = new sns.Topic(this, "Alerts", {
      displayName: "oki-dev blog alerts",
      enforceSSL: true,
    });
    topic.addSubscription(new EmailSubscription(props.alertEmail));
    const action = new SnsAction(topic);

    const alarm = (
      alarmId: string,
      metric: cloudwatch.IMetric,
      threshold: number,
      description: string,
    ) =>
      new cloudwatch.Alarm(this, alarmId, {
        metric,
        threshold,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: description,
      });

    const alarms = [
      alarm(
        "BuildDeadLettered",
        props.dlq.metricApproximateNumberOfMessagesVisible({
          period: Duration.minutes(1),
          statistic: "Maximum",
        }),
        1,
        "A build request failed twice and landed in the DLQ",
      ),
      alarm(
        "ApiErrors",
        props.apiFn.metricErrors({ period: Duration.minutes(5), statistic: "Sum" }),
        5,
        "blog-api: 5 or more errors in 5 minutes",
      ),
      alarm(
        "BuildErrors",
        props.buildFn.metricErrors({ period: Duration.minutes(5), statistic: "Sum" }),
        1,
        "blog-build failed",
      ),
    ];
    for (const a of alarms) {
      a.addAlarmAction(action);
      a.addOkAction(action);
    }

    new budgets.CfnBudget(this, "MonthlyBudget", {
      budget: {
        budgetName: "oki-dev-blog-monthly",
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount: 5, unit: "USD" },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            notificationType: "FORECASTED",
            comparisonOperator: "GREATER_THAN",
            threshold: 100,
            thresholdType: "PERCENTAGE",
          },
          subscribers: [{ subscriptionType: "EMAIL", address: props.alertEmail }],
        },
      ],
    });
  }
}
