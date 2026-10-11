import type { App } from "aws-cdk-lib";

export interface BlogConfig {
  account: string;
  region: string;
  domainName: string;
  hostedZoneId: string;
  alertEmail: string;
  adminDevOrigin: string;
  /**
   * GitHub OIDC subject prefix of the repository, in GitHub's immutable form
   * `repo:<owner>@<ownerId>/<repo>@<repoId>` (see GET /repos/{owner}/{repo}/actions/oidc/customization/sub).
   */
  githubOidcSubject: string;
  blogHost: string;
  adminHost: string;
  apiHost: string;
}

const KEYS = [
  "account",
  "region",
  "domainName",
  "hostedZoneId",
  "alertEmail",
  "adminDevOrigin",
  "githubOidcSubject",
] as const;

export function readConfig(app: App): BlogConfig {
  const values = {} as Record<(typeof KEYS)[number], string>;
  for (const key of KEYS) {
    const value: unknown = app.node.tryGetContext(key);
    if (typeof value !== "string" || value === "") throw new Error(`missing context: ${key}`);
    values[key] = value;
  }
  return {
    ...values,
    blogHost: `blog.${values.domainName}`,
    adminHost: `admin.${values.domainName}`,
    apiHost: `api.${values.domainName}`,
  };
}
