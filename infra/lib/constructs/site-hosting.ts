import { join } from "node:path";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import type * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import * as route53 from "aws-cdk-lib/aws-route53";
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import type { BlogConfig } from "../config";

const ONE_YEAR = Duration.days(365);

const privateBucket = (scope: Construct, id: string, props: s3.BucketProps = {}) =>
  new s3.Bucket(scope, id, {
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    encryption: s3.BucketEncryption.S3_MANAGED,
    enforceSSL: true,
    removalPolicy: RemovalPolicy.DESTROY,
    autoDeleteObjects: true,
    ...props,
  });

/** Uploaded images: retained and versioned; e2e uploads expire after a day. */
export const createMediaBucket = (scope: Construct, id: string, config: BlogConfig) =>
  privateBucket(scope, id, {
    removalPolicy: RemovalPolicy.RETAIN,
    autoDeleteObjects: false,
    versioned: true,
    cors: [
      {
        allowedMethods: [s3.HttpMethods.POST],
        allowedOrigins: [`https://${config.adminHost}`, config.adminDevOrigin],
        allowedHeaders: ["*"],
        maxAge: 3000,
      },
    ],
    lifecycleRules: [
      {
        id: "expire-e2e-uploads",
        prefix: "media/e2e/",
        expiration: Duration.days(1),
        noncurrentVersionExpiration: Duration.days(1),
      },
      { id: "expire-old-versions", noncurrentVersionExpiration: Duration.days(30) },
    ],
  });

export interface SiteHostingProps {
  config: BlogConfig;
  certificate: acm.ICertificate;
  zone: route53.IHostedZone;
  mediaBucket: s3.IBucket;
  /** Content-Security-Policy sent with the admin SPA. */
  adminCsp: string;
}

export class SiteHosting extends Construct {
  readonly siteBucket: s3.Bucket;
  readonly adminBucket: s3.Bucket;
  readonly blogDistribution: cloudfront.Distribution;
  readonly adminDistribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: SiteHostingProps) {
    super(scope, id);
    const { config, certificate, zone, mediaBucket, adminCsp } = props;

    this.siteBucket = privateBucket(this, "SiteBucket");
    this.adminBucket = privateBucket(this, "AdminBucket");

    const indexRewrite = new cloudfront.Function(this, "IndexRewrite", {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromFile({
        filePath: join(import.meta.dirname, "../../functions/rewrite-index.js"),
      }),
    });

    // HTML is sent with max-age=0 to browsers but kept at the edge until a build invalidates /*.
    const siteCache = new cloudfront.CachePolicy(this, "SiteCache", {
      comment: "oki-dev blog: cached at the edge until the next build invalidates it",
      minTtl: ONE_YEAR,
      defaultTtl: ONE_YEAR,
      maxTtl: ONE_YEAR,
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    const common = {
      certificate,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    };

    this.blogDistribution = new cloudfront.Distribution(this, "BlogDistribution", {
      ...common,
      domainNames: [config.blogHost],
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(this.siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: siteCache,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        compress: true,
        functionAssociations: [
          { function: indexRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
        ],
      },
      additionalBehaviors: {
        "/media/*": {
          origin: S3BucketOrigin.withOriginAccessControl(mediaBucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
          compress: true,
        },
      },
      errorResponses: [403, 404].map((httpStatus) => ({
        httpStatus,
        responseHttpStatus: 404,
        responsePagePath: "/404.html",
        ttl: Duration.minutes(1),
      })),
    });

    const adminHeaders = new cloudfront.ResponseHeadersPolicy(this, "AdminHeaders", {
      comment: "oki-dev admin: security headers + CSP",
      securityHeadersBehavior: {
        contentSecurityPolicy: { contentSecurityPolicy: adminCsp, override: true },
        strictTransportSecurity: { accessControlMaxAge: ONE_YEAR, override: true },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        xssProtection: { protection: true, modeBlock: true, override: true },
      },
    });

    this.adminDistribution = new cloudfront.Distribution(this, "AdminDistribution", {
      ...common,
      domainNames: [config.adminHost],
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(this.adminBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: adminHeaders,
        compress: true,
      },
      // Single-page app: unknown paths render index.html.
      errorResponses: [403, 404].map((httpStatus) => ({
        httpStatus,
        responseHttpStatus: 200,
        responsePagePath: "/index.html",
        ttl: Duration.seconds(10),
      })),
    });

    const records: Array<[string, string, cloudfront.Distribution]> = [
      ["Blog", config.blogHost, this.blogDistribution],
      ["Admin", config.adminHost, this.adminDistribution],
    ];
    for (const [name, host, distribution] of records) {
      const target = route53.RecordTarget.fromAlias(new CloudFrontTarget(distribution));
      new route53.ARecord(this, `${name}A`, { zone, recordName: host, target });
      new route53.AaaaRecord(this, `${name}Aaaa`, { zone, recordName: host, target });
    }
  }
}
