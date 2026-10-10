import { Duration, RemovalPolicy, Size } from "aws-cdk-lib";
import type * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import * as logs from "aws-cdk-lib/aws-logs";
import type * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

export interface BuildPipelineProps {
  table: dynamodb.ITableV2;
  siteBucket: s3.IBucket;
  distribution: cloudfront.Distribution;
  repoRoot: string;
}

/** SQS FIFO (one message group) → Build Lambda: one build at a time, batches collapsed. */
export class BuildPipeline extends Construct {
  readonly queue: sqs.Queue;
  readonly dlq: sqs.Queue;
  readonly fn: lambda.DockerImageFunction;

  constructor(scope: Construct, id: string, props: BuildPipelineProps) {
    super(scope, id);
    const timeout = Duration.minutes(5);

    this.dlq = new sqs.Queue(this, "BuildDlq", {
      fifo: true,
      retentionPeriod: Duration.days(14),
      enforceSSL: true,
    });
    this.queue = new sqs.Queue(this, "BuildQueue", {
      fifo: true,
      contentBasedDeduplication: false,
      // AWS guidance for Lambda event sources: at least six times the function timeout.
      visibilityTimeout: Duration.minutes(30),
      deadLetterQueue: { queue: this.dlq, maxReceiveCount: 2 },
      enforceSSL: true,
    });

    this.fn = new lambda.DockerImageFunction(this, "BuildFunction", {
      functionName: "blog-build",
      code: lambda.DockerImageCode.fromImageAsset(props.repoRoot, {
        file: "services/build/Dockerfile",
        platform: Platform.LINUX_AMD64,
      }),
      architecture: lambda.Architecture.X86_64,
      memorySize: 2048,
      timeout,
      ephemeralStorageSize: Size.gibibytes(2),
      logGroup: new logs.LogGroup(this, "BuildLogs", {
        logGroupName: "/aws/lambda/blog-build",
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: {
        TABLE_NAME: props.table.tableName,
        SITE_BUCKET: props.siteBucket.bucketName,
        DISTRIBUTION_ID: props.distribution.distributionId,
      },
    });
    this.fn.addEventSource(new SqsEventSource(this.queue, { batchSize: 10 }));

    props.table.grantReadWriteData(this.fn);
    props.siteBucket.grantReadWrite(this.fn);
    props.siteBucket.grantDelete(this.fn);
    props.distribution.grantCreateInvalidation(this.fn);
    this.fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:GetInvalidation"],
        resources: [props.distribution.distributionArn],
      }),
    );
  }
}
