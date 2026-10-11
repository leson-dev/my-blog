import { describe, expect, it } from "vitest";
import { adminCsp } from "../lib/constructs/admin-csp";

const csp = adminCsp({
  apiOrigin: "https://api.example.dev",
  cognitoOrigin: "https://auth.example.dev",
  uploadOrigin: "https://media.s3.ap-northeast-1.amazonaws.com",
});
const directive = (name: string) =>
  csp
    .split("; ")
    .find((d) => d.startsWith(`${name} `))
    ?.slice(name.length + 1)
    .split(" ");

describe("adminCsp", () => {
  it("only runs the app's own scripts (WebAssembly allowed for Shiki)", () => {
    expect(directive("script-src")).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it("only connects to itself, the API, Cognito and the upload bucket", () => {
    expect(directive("connect-src")).toEqual([
      "'self'",
      "https://api.example.dev",
      "https://auth.example.dev",
      "https://media.s3.ap-northeast-1.amazonaws.com",
    ]);
  });

  it("allows CodeMirror/Shiki inline styles and https images, and cannot be framed", () => {
    expect(directive("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(directive("img-src")).toEqual(["'self'", "data:", "blob:", "https:"]);
    expect(directive("frame-ancestors")).toEqual(["'none'"]);
    expect(directive("object-src")).toEqual(["'none'"]);
  });
});
