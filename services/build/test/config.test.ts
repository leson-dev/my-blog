import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

const env = { TABLE_NAME: "BlogTable", SITE_BUCKET: "blog-site", DISTRIBUTION_ID: "E123" };

describe("loadConfig", () => {
  it("applies Lambda defaults: read-only site in the image, everything writable under /tmp", () => {
    expect(loadConfig(env)).toEqual({
      ...env,
      SITE_DIR: "/opt/blog/apps/site",
      DATA_DIR: "/tmp/site-data",
      OUT_DIR: "/tmp/site-dist",
      CACHE_DIR: "/tmp/site-cache",
      DOT_ASTRO_DIR: "/tmp/astro-dot",
    });
  });

  it("fails fast without the site bucket", () => {
    const { SITE_BUCKET: _omit, ...rest } = env;
    expect(() => loadConfig(rest)).toThrow(/SITE_BUCKET/);
  });
});
