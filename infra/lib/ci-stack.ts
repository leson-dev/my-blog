import { Duration, Stack, type StackProps } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

const GITHUB_ISSUER = "token.actions.githubusercontent.com";
/** Default CDK bootstrap qualifier. */
const QUALIFIER = "hnb659fds";

/**
 * GitHub Actions → AWS without stored keys. Deployed by hand once (`cdk deploy BlogCi`);
 * the deploy workflow never touches this stack, so it cannot widen its own permissions.
 */
export class CiStack extends Stack {
  readonly deployRole: iam.Role;
  readonly gcRole: iam.Role;

  constructor(scope: Construct, id: string, props: StackProps & { githubRepo: string }) {
    super(scope, id, props);
    const { account, region } = this;

    const provider = new iam.OidcProviderNative(this, "GitHubOidc", {
      url: `https://${GITHUB_ISSUER}`,
      clientIds: ["sts.amazonaws.com"],
    });
    // Only workflows running on main of this repository (not forks, not pull requests).
    const githubMain = () =>
      new iam.WebIdentityPrincipal(provider.oidcProviderArn, {
        StringEquals: {
          [`${GITHUB_ISSUER}:aud`]: "sts.amazonaws.com",
          [`${GITHUB_ISSUER}:sub`]: `repo:${props.githubRepo}:ref:refs/heads/main`,
        },
      });

    this.deployRole = new iam.Role(this, "DeployRole", {
      roleName: "blog-github-deploy",
      description:
        "GitHub Actions (main): cdk deploy through the bootstrap roles, then rebuild the site",
      assumedBy: githubMain(),
      maxSessionDuration: Duration.hours(1),
    });
    // Every resource change goes through the bootstrap roles (deploy, file/image publishing, lookup).
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: [`arn:aws:iam::${account}:role/cdk-${QUALIFIER}-*-${account}-*`],
      }),
    );
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["sqs:SendMessage"],
        resources: [`arn:aws:sqs:${region}:${account}:Blog-BuildBuildQueue*`],
      }),
    );
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:GetItem"],
        resources: [`arn:aws:dynamodb:${region}:${account}:table/BlogData-BlogTable*`],
      }),
    );

    this.gcRole = new iam.Role(this, "GcRole", {
      roleName: "blog-github-gc",
      description: "GitHub Actions (main): cdk gc of unused bootstrap assets",
      assumedBy: githubMain(),
      maxSessionDuration: Duration.hours(1),
    });
    // cdk gc reads every template to find assets still in use.
    this.gcRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "cloudformation:ListStacks",
          "cloudformation:DescribeStacks",
          "cloudformation:GetTemplate",
        ],
        resources: ["*"],
      }),
    );
    this.gcRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [`arn:aws:ssm:*:${account}:parameter/cdk-bootstrap/${QUALIFIER}/version`],
      }),
    );
    const assetBuckets = `arn:aws:s3:::cdk-${QUALIFIER}-assets-${account}-*`;
    this.gcRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:ListBucket", "s3:GetBucketLocation"],
        resources: [assetBuckets],
      }),
    );
    this.gcRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObjectTagging", "s3:PutObjectTagging", "s3:DeleteObject"],
        resources: [`${assetBuckets}/*`],
      }),
    );
    this.gcRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "ecr:DescribeRepositories",
          "ecr:DescribeImages",
          "ecr:ListImages",
          "ecr:BatchGetImage",
          "ecr:PutImage",
          "ecr:BatchDeleteImage",
        ],
        resources: [
          `arn:aws:ecr:*:${account}:repository/cdk-${QUALIFIER}-container-assets-${account}-*`,
        ],
      }),
    );
  }
}
