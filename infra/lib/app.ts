import { existsSync } from "node:fs";
import { join } from "node:path";
import type { App } from "aws-cdk-lib";
import { BlogStack } from "./blog-stack";
import { CertStack } from "./cert-stack";
import { CiStack } from "./ci-stack";
import { readConfig } from "./config";
import { DataStack } from "./data-stack";

export function createStacks(
  app: App,
  repoRoot: string,
  adminDist: string = join(repoRoot, "apps/admin/dist"),
) {
  if (!existsSync(join(adminDist, "index.html"))) {
    throw new Error(
      `${adminDist}/index.html not found — build the admin app first: pnpm --filter @blog/admin build`,
    );
  }
  const config = readConfig(app);
  const env = { account: config.account, region: config.region };
  const cert = new CertStack(app, "BlogCert", {
    env: { account: config.account, region: "us-east-1" },
    crossRegionReferences: true,
    config,
  });
  const data = new DataStack(app, "BlogData", { env, config });
  const blog = new BlogStack(app, "Blog", {
    env,
    config,
    certificate: cert.certificate,
    data,
    repoRoot,
    adminDist,
  });
  const ci = new CiStack(app, "BlogCi", { env, githubRepo: config.githubRepo });
  return { cert, data, blog, ci };
}
