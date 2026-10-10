import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

const env = {
  TABLE_NAME: "BlogTable",
  BUILD_QUEUE_URL: "https://sqs.ap-northeast-1.amazonaws.com/111111111111/build.fifo",
  MEDIA_BUCKET: "blog-media",
  BLOG_BASE_URL: "https://blog.oki-dev.xyz/",
  SCHEDULER_GROUP: "blog-publish",
  SCHEDULER_TARGET_ARN: "arn:aws:lambda:ap-northeast-1:111111111111:function:api",
  SCHEDULER_ROLE_ARN: "arn:aws:iam::111111111111:role/scheduler",
};

describe("loadConfig", () => {
  it("accepts a complete environment and strips the trailing slash of BLOG_BASE_URL", () => {
    expect(loadConfig(env).BLOG_BASE_URL).toBe("https://blog.oki-dev.xyz");
  });

  it("fails fast when a variable is missing", () => {
    const { TABLE_NAME: _omit, ...rest } = env;
    expect(() => loadConfig(rest)).toThrow(/TABLE_NAME/);
  });
});
