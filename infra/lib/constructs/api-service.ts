import { join } from "node:path";
import { ArnFormat, Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpUserPoolAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import type * as cognito from "aws-cdk-lib/aws-cognito";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as route53 from "aws-cdk-lib/aws-route53";
import { ApiGatewayv2DomainProperties } from "aws-cdk-lib/aws-route53-targets";
import type * as s3 from "aws-cdk-lib/aws-s3";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import type * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import type { BlogConfig } from "../config";

/** Route keys served by services/api (Plan 1b, Task 8). */
export const API_ROUTES = [
  "GET /posts",
  "POST /posts",
  "GET /posts/{id}",
  "PUT /posts/{id}",
  "DELETE /posts/{id}",
  "PUT /posts/{id}/versions/{lang}",
  "DELETE /posts/{id}/versions/{lang}",
  "POST /posts/{id}/versions/{lang}/publish",
  "POST /posts/{id}/versions/{lang}/unpublish",
  "GET /tags",
  "PUT /tags/{key}",
  "POST /uploads",
  "GET /builds/latest",
  "POST /builds",
] as const;

export interface ApiServiceProps {
  config: BlogConfig;
  zone: route53.IHostedZone;
  table: dynamodb.ITableV2;
  mediaBucket: s3.IBucket;
  buildQueue: sqs.IQueue;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  repoRoot: string;
}

export class ApiService extends Construct {
  readonly fn: NodejsFunction;
  readonly httpApi: apigwv2.HttpApi;
  readonly url: string;

  constructor(scope: Construct, id: string, props: ApiServiceProps) {
    super(scope, id);
    const { config, zone } = props;
    const stack = Stack.of(this);

    const scheduleGroup = new scheduler.ScheduleGroup(this, "PublishSchedules", {
      scheduleGroupName: "blog-publish",
    });

    // The function's own ARN goes into its environment: build it from the fixed name
    // instead of referencing the function (which would be a circular dependency).
    const functionName = "blog-api";
    const functionArn = stack.formatArn({
      service: "lambda",
      resource: "function",
      resourceName: functionName,
      arnFormat: ArnFormat.COLON_RESOURCE_NAME,
    });

    const schedulerRole = new iam.Role(this, "SchedulerRole", {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com", {
        conditions: { StringEquals: { "aws:SourceAccount": stack.account } },
      }),
      description: "EventBridge Scheduler invokes blog-api for scheduled publishing",
    });
    schedulerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [functionArn, `${functionArn}:*`],
      }),
    );

    this.fn = new NodejsFunction(this, "ApiFunction", {
      functionName,
      entry: join(props.repoRoot, "services/api/src/index.ts"),
      handler: "handler",
      projectRoot: props.repoRoot,
      depsLockFilePath: join(props.repoRoot, "pnpm-lock.yaml"),
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(10),
      logGroup: new logs.LogGroup(this, "ApiLogs", {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      bundling: {
        format: OutputFormat.ESM,
        target: "node24",
        minify: true,
        sourceMap: true,
        mainFields: ["module", "main"],
        banner:
          "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
      environment: {
        TABLE_NAME: props.table.tableName,
        BUILD_QUEUE_URL: props.buildQueue.queueUrl,
        MEDIA_BUCKET: props.mediaBucket.bucketName,
        BLOG_BASE_URL: `https://${config.blogHost}`,
        SCHEDULER_GROUP: scheduleGroup.scheduleGroupName,
        SCHEDULER_TARGET_ARN: functionArn,
        SCHEDULER_ROLE_ARN: schedulerRole.roleArn,
        NODE_OPTIONS: "--enable-source-maps",
      },
    });

    props.table.grantReadWriteData(this.fn);
    props.buildQueue.grantSendMessages(this.fn);
    props.mediaBucket.grantPut(this.fn);
    this.fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "scheduler:CreateSchedule",
          "scheduler:UpdateSchedule",
          "scheduler:DeleteSchedule",
        ],
        resources: [
          stack.formatArn({
            service: "scheduler",
            resource: "schedule",
            resourceName: `${scheduleGroup.scheduleGroupName}/*`,
            arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
          }),
        ],
      }),
    );
    schedulerRole.grantPassRole(this.fn.grantPrincipal);

    const certificate = new acm.Certificate(this, "ApiCertificate", {
      domainName: config.apiHost,
      validation: acm.CertificateValidation.fromDns(zone),
    });
    const domainName = new apigwv2.DomainName(this, "ApiDomain", {
      domainName: config.apiHost,
      certificate,
    });

    this.httpApi = new apigwv2.HttpApi(this, "HttpApi", {
      apiName: "blog-api",
      createDefaultStage: false,
      defaultAuthorizer: new HttpUserPoolAuthorizer("Cognito", props.userPool, {
        userPoolClients: [props.userPoolClient],
      }),
      corsPreflight: {
        allowOrigins: [`https://${config.adminHost}`, config.adminDevOrigin],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.DELETE,
        ],
        allowHeaders: ["authorization", "content-type"],
        maxAge: Duration.days(1),
      },
    });
    new apigwv2.HttpStage(this, "DefaultStage", {
      httpApi: this.httpApi,
      stageName: "$default",
      autoDeploy: true,
      throttle: { rateLimit: 20, burstLimit: 40 },
      domainMapping: { domainName },
    });

    const integration = new HttpLambdaIntegration("Api", this.fn);
    for (const routeKey of API_ROUTES) {
      const [method, path] = routeKey.split(" ") as [keyof typeof apigwv2.HttpMethod, string];
      this.httpApi.addRoutes({ path, methods: [apigwv2.HttpMethod[method]], integration });
    }

    new route53.ARecord(this, "ApiA", {
      zone,
      recordName: config.apiHost,
      target: route53.RecordTarget.fromAlias(
        new ApiGatewayv2DomainProperties(
          domainName.regionalDomainName,
          domainName.regionalHostedZoneId,
        ),
      ),
    });
    this.url = `https://${config.apiHost}`;
  }
}
