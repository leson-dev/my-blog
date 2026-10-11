// @vitest-environment node
import { describe, expect, it } from "vitest";
import { challengeFor, randomVerifier } from "../../src/auth/pkce";

describe("PKCE", () => {
  it("derives the S256 challenge of RFC 7636 appendix B", async () => {
    await expect(challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).resolves.toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("makes 43-character URL-safe verifiers that differ each time", () => {
    const a = randomVerifier();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomVerifier()).not.toBe(a);
  });
});
