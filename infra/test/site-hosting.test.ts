import { Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import { describe, expect, it } from "vitest";
import { readConfig } from "../lib/config";
import { createMediaBucket, SiteHosting } from "../lib/constructs/site-hosting";
import { testApp } from "./helpers";

const synth = () => {
  const app = testApp();
  const config = readConfig(app);
  const stack = new Stack(app, "Hosting", {
    env: { account: "111111111111", region: "ap-northeast-1" },
  });
  new SiteHosting(stack, "Hosting", {
    config,
    certificate: acm.Certificate.fromCertificateArn(
      stack,
      "Cert",
      "arn:aws:acm:us-east-1:111111111111:certificate/x",
    ),
    zone: route53.HostedZone.fromHostedZoneAttributes(stack, "Zone", {
      hostedZoneId: "ZTEST123",
      zoneName: "example.dev",
    }),
    mediaBucket: createMediaBucket(stack, "Media", config),
    adminCsp: "default-src 'self'",
  });
  return Template.fromStack(stack);
};

describe("SiteHosting", () => {
  it("keeps every bucket private, encrypted and TLS-only", () => {
    const template = synth();
    template.allResourcesProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: Match.anyValue(),
    });
  });

  it("retains and versions the media bucket, expires old versions and allows admin POST uploads", () => {
    const template = synth();
    template.hasResource("AWS::S3::Bucket", {
      DeletionPolicy: "Retain",
      Properties: Match.objectLike({
        VersioningConfiguration: { Status: "Enabled" },
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({ Id: "expire-old-versions", Status: "Enabled" }),
          ]),
        },
        CorsConfiguration: {
          CorsRules: [
            Match.objectLike({
              AllowedMethods: ["POST"],
              AllowedOrigins: ["https://admin.example.dev", "http://localhost:5173"],
            }),
          ],
        },
      }),
    });
    const prefixes = Object.values(template.findResources("AWS::S3::Bucket"))
      .flatMap((b) => b.Properties?.LifecycleConfiguration?.Rules ?? [])
      .map((r: { Prefix?: string }) => r.Prefix);
    expect(prefixes).not.toContain("media/e2e/");
  });

  it("serves the blog through CloudFront with OAC, the index rewrite and long edge caching", () => {
    const template = synth();
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        Aliases: ["blog.example.dev"],
        HttpVersion: "http2and3",
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: "redirect-to-https",
          FunctionAssociations: [Match.objectLike({ EventType: "viewer-request" })],
        }),
        CacheBehaviors: [Match.objectLike({ PathPattern: "/media/*" })],
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({ ErrorCode: 403, ResponseCode: 404, ResponsePagePath: "/404.html" }),
          Match.objectLike({ ErrorCode: 404, ResponseCode: 404, ResponsePagePath: "/404.html" }),
        ]),
      }),
    });
    template.hasResourceProperties("AWS::CloudFront::CachePolicy", {
      CachePolicyConfig: Match.objectLike({
        MinTTL: 31536000,
        DefaultTTL: 31536000,
        MaxTTL: 31536000,
      }),
    });
    template.resourcePropertiesCountIs(
      "AWS::CloudFront::OriginAccessControl",
      { OriginAccessControlConfig: Match.objectLike({ OriginAccessControlOriginType: "s3" }) },
      3,
    );
  });

  it("serves the admin SPA with index.html as the fallback", () => {
    synth().hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        Aliases: ["admin.example.dev"],
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({ ErrorCode: 403, ResponseCode: 200, ResponsePagePath: "/index.html" }),
        ]),
      }),
    });
  });

  it("points blog and admin A/AAAA records at the distributions", () => {
    const template = synth();
    for (const type of ["A", "AAAA"]) {
      for (const name of ["blog.example.dev.", "admin.example.dev."]) {
        template.hasResourceProperties("AWS::Route53::RecordSet", { Name: name, Type: type });
      }
    }
  });
  it("sends the admin CSP with the usual security headers on the admin distribution only", () => {
    const template = synth();
    template.hasResourceProperties("AWS::CloudFront::ResponseHeadersPolicy", {
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: Match.objectLike({
          ContentSecurityPolicy: { ContentSecurityPolicy: "default-src 'self'", Override: true },
          FrameOptions: { FrameOption: "DENY", Override: true },
          StrictTransportSecurity: Match.objectLike({ AccessControlMaxAgeSec: 31536000 }),
          ContentTypeOptions: { Override: true },
          ReferrerPolicy: { ReferrerPolicy: "strict-origin-when-cross-origin", Override: true },
        }),
      }),
    });
    template.resourceCountIs("AWS::CloudFront::ResponseHeadersPolicy", 1);
  });
});
