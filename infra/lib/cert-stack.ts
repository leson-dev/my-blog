import { Stack, type StackProps } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import type { Construct } from "constructs";
import type { BlogConfig } from "./config";

/** CloudFront only accepts certificates from us-east-1. */
export class CertStack extends Stack {
  readonly certificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props: StackProps & { config: BlogConfig }) {
    super(scope, id, props);
    const { config } = props;
    const zone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", {
      hostedZoneId: config.hostedZoneId,
      zoneName: config.domainName,
    });
    this.certificate = new acm.Certificate(this, "EdgeCertificate", {
      domainName: config.blogHost,
      subjectAlternativeNames: [config.adminHost],
      validation: acm.CertificateValidation.fromDns(zone),
    });
  }
}
