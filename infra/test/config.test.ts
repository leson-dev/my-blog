import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readConfig } from "../lib/config";
import { TEST_CONTEXT, testApp } from "./helpers";

describe("readConfig", () => {
  it("reads the context and derives the three host names", () => {
    expect(readConfig(testApp())).toEqual({
      ...TEST_CONTEXT,
      blogHost: "blog.example.dev",
      adminHost: "admin.example.dev",
      apiHost: "api.example.dev",
    });
  });

  it("fails on a missing value", () => {
    const { alertEmail: _omit, ...rest } = TEST_CONTEXT;
    expect(() => readConfig(testApp(rest))).toThrow("missing context: alertEmail");
  });

  it("trusts the GitHub repository the blog actually lives in", () => {
    const cdkJson = JSON.parse(readFileSync(join(import.meta.dirname, "../cdk.json"), "utf8"));
    expect(cdkJson.context.githubRepo).toBe("leson-dev/my-blog");
  });
});
