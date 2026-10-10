import { Template } from "aws-cdk-lib/assertions";
import { describe, it } from "vitest";
import { CertStack } from "../lib/cert-stack";
import { readConfig } from "../lib/config";
import { testApp } from "./helpers";

describe("CertStack", () => {
  it("issues one DNS-validated certificate for the blog and admin hosts", () => {
    const app = testApp();
    const stack = new CertStack(app, "Cert", {
      env: { account: "111111111111", region: "us-east-1" },
      config: readConfig(app),
    });
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::CertificateManager::Certificate", 1);
    template.hasResourceProperties("AWS::CertificateManager::Certificate", {
      DomainName: "blog.example.dev",
      SubjectAlternativeNames: ["admin.example.dev"],
      ValidationMethod: "DNS",
    });
  });
});
