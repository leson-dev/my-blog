import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { createStacks } from "../lib/app";
import { ADMIN_DIST_FIXTURE, repoRoot, testApp } from "./helpers";

const synth = () => Template.fromStack(createStacks(testApp(), repoRoot, ADMIN_DIST_FIXTURE).ci);

type Statement = {
  Action: string | string[];
  Resource?: unknown;
  Condition?: Record<string, Record<string, string>>;
};

const roleNamed = (template: Template, name: string) => {
  const roles = Object.values(template.findResources("AWS::IAM::Role")).filter(
    (r) => r.Properties.RoleName === name,
  );
  expect(roles).toHaveLength(1);
  return roles[0] as { Properties: { AssumeRolePolicyDocument: { Statement: Statement[] } } };
};

const policyStatements = (template: Template, roleLogicalIdPrefix: string): Statement[] =>
  Object.entries(template.findResources("AWS::IAM::Policy"))
    .filter(([id]) => id.startsWith(roleLogicalIdPrefix))
    .flatMap(([, p]) => p.Properties.PolicyDocument.Statement as Statement[]);

const actionsOf = (statements: Statement[]) =>
  statements.flatMap((s) => (Array.isArray(s.Action) ? s.Action : [s.Action])).sort();

describe("CiStack", () => {
  it("trusts GitHub's OIDC issuer for sts.amazonaws.com", () => {
    synth().hasResourceProperties("AWS::IAM::OIDCProvider", {
      Url: "https://token.actions.githubusercontent.com",
      ClientIdList: ["sts.amazonaws.com"],
    });
  });

  it.each(["blog-github-deploy", "blog-github-gc"])(
    "%s can only be assumed by workflows on main of this repo",
    (name) => {
      const [trust] = roleNamed(synth(), name).Properties.AssumeRolePolicyDocument.Statement;
      expect(trust?.Action).toBe("sts:AssumeRoleWithWebIdentity");
      expect(trust?.Condition).toEqual({
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:example@1/blog@2:ref:refs/heads/main",
        },
      });
    },
  );

  it("lets the deploy role only use the CDK bootstrap roles, send a build and read its status", () => {
    const statements = policyStatements(synth(), "DeployRole");
    expect(actionsOf(statements)).toEqual([
      "dynamodb:GetItem",
      "sqs:SendMessage",
      "sts:AssumeRole",
    ]);
    const json = JSON.stringify(statements);
    expect(json).toContain(":role/cdk-hnb659fds-*-111111111111-*");
    expect(json).toContain(":Blog-BuildBuildQueue*");
    expect(json).toContain(":table/BlogData-BlogTable*");
  });

  it("gives the gc role no way to deploy or assume other roles", () => {
    const statements = policyStatements(synth(), "GcRole");
    const actions = actionsOf(statements);
    expect(actions).not.toContain("sts:AssumeRole");
    expect(
      actions.some(
        (a) => a.startsWith("cloudformation:") && !/^cloudformation:(List|Get|Describe)/.test(a),
      ),
    ).toBe(false);
    expect(JSON.stringify(statements)).toContain("cdk-hnb659fds-container-assets-111111111111-*");
  });

  it("is deployed by hand and does not depend on the application stacks", () => {
    const app = testApp();
    const { ci } = createStacks(app, repoRoot, ADMIN_DIST_FIXTURE);
    app.synth();
    expect(ci.dependencies).toHaveLength(0);
    expect(ci.stackName).toBe("BlogCi");
  });
});
