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
});
