import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { readConfig } from "../lib/config";
import { DataStack } from "../lib/data-stack";
import { testApp } from "./helpers";

const synth = () => {
  const app = testApp();
  const stack = new DataStack(app, "Data", {
    env: { account: "111111111111", region: "ap-northeast-1" },
    config: readConfig(app),
  });
  return { stack, template: Template.fromStack(stack) };
};

describe("DataStack", () => {
  it("is protected against accidental deletion", () => {
    expect(synth().stack.terminationProtection).toBe(true);
  });

  it("turns on deletion protection for the table and the user pool", () => {
    const { template } = synth();
    template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      Replicas: [Match.objectLike({ DeletionProtectionEnabled: true })],
    });
    template.hasResourceProperties("AWS::Cognito::UserPool", { DeletionProtection: "ACTIVE" });
  });

  it("creates the single table with the byUpdated index, PITR and retention", () => {
    const { template } = synth();
    template.hasResource("AWS::DynamoDB::GlobalTable", {
      DeletionPolicy: "Retain",
      Properties: Match.objectLike({
        KeySchema: [
          { AttributeName: "PK", KeyType: "HASH" },
          { AttributeName: "SK", KeyType: "RANGE" },
        ],
        BillingMode: "PAY_PER_REQUEST",
        GlobalSecondaryIndexes: [
          Match.objectLike({
            IndexName: "byUpdated",
            KeySchema: [
              { AttributeName: "GSI1PK", KeyType: "HASH" },
              { AttributeName: "GSI1SK", KeyType: "RANGE" },
            ],
          }),
        ],
        Replicas: [
          Match.objectLike({
            PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
          }),
        ],
      }),
    });
  });

  it("creates an admin-only user pool with mandatory TOTP MFA", () => {
    const { template } = synth();
    template.hasResource("AWS::Cognito::UserPool", {
      DeletionPolicy: "Retain",
      Properties: Match.objectLike({
        AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
        MfaConfiguration: "ON",
        EnabledMfas: ["SOFTWARE_TOKEN_MFA"],
        UsernameAttributes: ["email"],
      }),
    });
    template.hasResourceProperties("AWS::Cognito::UserPoolGroup", { GroupName: "e2e" });
  });

  it("creates a public OAuth code client for the admin with managed login", () => {
    const { template } = synth();
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      GenerateSecret: false,
      AllowedOAuthFlows: ["code"],
      AllowedOAuthScopes: Match.arrayWith(["openid", "email"]),
      CallbackURLs: ["https://admin.example.dev/", "http://localhost:5173/"],
    });
    template.hasResourceProperties("AWS::Cognito::UserPoolDomain", {
      Domain: "oki-dev-blog-111111111111",
      ManagedLoginVersion: 2,
    });
    template.resourceCountIs("AWS::Cognito::ManagedLoginBranding", 1);
  });
});
