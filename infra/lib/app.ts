import type { App } from "aws-cdk-lib";
import { BlogStack } from "./blog-stack";
import { CertStack } from "./cert-stack";
import { readConfig } from "./config";
import { DataStack } from "./data-stack";

export function createStacks(app: App, repoRoot: string) {
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
  });
  return { cert, data, blog };
}
