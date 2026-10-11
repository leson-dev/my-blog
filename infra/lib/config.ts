import type { App } from "aws-cdk-lib";

export interface BlogConfig {
  account: string;
  region: string;
  domainName: string;
  hostedZoneId: string;
  alertEmail: string;
  adminDevOrigin: string;
  /** "owner/repo" trusted by the GitHub OIDC roles. */
  githubRepo: string;
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
  "githubRepo",
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
