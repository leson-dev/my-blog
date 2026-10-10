import { mkdirSync } from "node:fs";
import { CloudFrontClient } from "@aws-sdk/client-cloudfront";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { Config } from "./config";
import { exportSiteData } from "./exportData";
import { invalidateAll } from "./invalidate";
import type { BuildDeps } from "./runBuild";
import { prepareDotAstro, runSiteBuild } from "./siteBuild";
import { DynamoBuildStatus } from "./status";
import { deleteKeys, syncToS3 } from "./syncSite";

export function createDeps(config: Config, log: BuildDeps["log"]): BuildDeps {
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const s3 = new S3Client({});
  const cf = new CloudFrontClient({});
  return {
    now: () => new Date().toISOString(),
    status: new DynamoBuildStatus(db, config.TABLE_NAME),
    prepare: () => {
      prepareDotAstro(config.DOT_ASTRO_DIR, config.SITE_DIR);
      mkdirSync(config.CACHE_DIR, { recursive: true });
    },
    exportData: (dir) => exportSiteData(db, config.TABLE_NAME, dir),
    buildSite: (dataDir, deadline) =>
      runSiteBuild({
        siteDir: config.SITE_DIR,
        dataDir,
        outDir: config.OUT_DIR,
        cacheDir: config.CACHE_DIR,
        deadline,
      }),
    sync: (distDir) => syncToS3(s3, config.SITE_BUCKET, distDir),
    invalidate: (reference) => invalidateAll(cf, config.DISTRIBUTION_ID, reference),
    removeStaleAssets: (keys) => deleteKeys(s3, config.SITE_BUCKET, keys),
    log,
    dataDir: config.DATA_DIR,
  };
}
