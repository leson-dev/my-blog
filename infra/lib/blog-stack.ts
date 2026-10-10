import { CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import type * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import type { Construct } from "constructs";
import type { BlogConfig } from "./config";
import { ApiService } from "./constructs/api-service";
import { BuildPipeline } from "./constructs/build-pipeline";
import { Monitoring } from "./constructs/monitoring";
import { createMediaBucket, SiteHosting } from "./constructs/site-hosting";
import type { DataStack } from "./data-stack";

const ADMIN_PLACEHOLDER = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><title>oki-dev admin</title></head>
<body style="font-family:monospace;background:#0d1117;color:#7ee787;padding:2rem">~/oki-dev/admin$ coming soon</body></html>`;

export interface BlogStackProps extends StackProps {
  config: BlogConfig;
  certificate: acm.ICertificate;
  data: DataStack;
  repoRoot: string;
}

export class BlogStack extends Stack {
  constructor(scope: Construct, id: string, props: BlogStackProps) {
    super(scope, id, { ...props, crossRegionReferences: true });
    const { config, data } = props;

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", {
      hostedZoneId: config.hostedZoneId,
      zoneName: config.domainName,
    });
    // Lives here (not in BlogData): CloudFront OAC edits its bucket policy, which would
    // otherwise make BlogData depend on Blog and create a cycle.
    const mediaBucket = createMediaBucket(this, "MediaBucket", config);

    const hosting = new SiteHosting(this, "Hosting", {
      config,
      certificate: props.certificate,
      zone,
      mediaBucket,
    });
    const build = new BuildPipeline(this, "Build", {
      table: data.table,
      siteBucket: hosting.siteBucket,
      distribution: hosting.blogDistribution,
      repoRoot: props.repoRoot,
    });
    const api = new ApiService(this, "Api", {
      config,
      zone,
      table: data.table,
      mediaBucket,
      buildQueue: build.queue,
      userPool: data.userPool,
      userPoolClient: data.userPoolClient,
      repoRoot: props.repoRoot,
    });
    new Monitoring(this, "Monitoring", {
      alertEmail: config.alertEmail,
      apiFn: api.fn,
      buildFn: build.fn,
      dlq: build.dlq,
    });

    // Runtime configuration for the admin SPA (Plan 5 adds the app itself next to it).
    new s3deploy.BucketDeployment(this, "AdminConfig", {
      destinationBucket: hosting.adminBucket,
      sources: [
        s3deploy.Source.jsonData("config.json", {
          region: this.region,
          apiUrl: api.url,
          userPoolId: data.userPool.userPoolId,
          userPoolClientId: data.userPoolClient.userPoolClientId,
          cognitoDomain: data.userPoolDomain.baseUrl(),
          redirectUri: `https://${config.adminHost}/`,
        }),
        s3deploy.Source.data("index.html", ADMIN_PLACEHOLDER),
      ],
      distribution: hosting.adminDistribution,
      distributionPaths: ["/config.json", "/index.html"],
      prune: false,
    });

    new CfnOutput(this, "BlogUrl", { value: `https://${config.blogHost}/` });
    new CfnOutput(this, "AdminUrl", { value: `https://${config.adminHost}/` });
    new CfnOutput(this, "ApiUrl", { value: api.url });
    new CfnOutput(this, "BuildQueueUrl", { value: build.queue.queueUrl });
    new CfnOutput(this, "UserPoolId", { value: data.userPool.userPoolId });
    new CfnOutput(this, "SiteBucketName", { value: hosting.siteBucket.bucketName });
  }
}
