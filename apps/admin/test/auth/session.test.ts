// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { challengeFor } from "../../src/auth/pkce";
import { AuthSession } from "../../src/auth/session";
import type { AdminConfig } from "../../src/config";
import { MemoryStorage } from "../memoryStorage";

const config: AdminConfig = {
  region: "ap-northeast-1",
  apiUrl: "https://api.example.dev",
  userPoolId: "pool",
  userPoolClientId: "client123",
  cognitoDomain: "https://auth.example.dev",
  redirectUri: "https://admin.example.dev/",
};

const tokenResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function setup() {
  const storage = new MemoryStorage();
  const flowStorage = new MemoryStorage();
  const navigate = vi.fn<(url: string) => void>();
  const fetch = vi.fn<typeof globalThis.fetch>();
  let clock = 1_000_000;
  const session = new AuthSession(config, {
    fetch,
    storage,
    flowStorage,
    navigate,
    now: () => clock,
  });
  return { session, storage, flowStorage, navigate, fetch, tick: (ms: number) => (clock += ms) };
}

/** Form body of the n-th token request. */
const formOf = (fetch: { mock: { calls: unknown[][] } }, n: number) =>
  new URLSearchParams(
    (fetch.mock.calls[n]?.[1] as RequestInit | undefined)?.body as URLSearchParams,
  );

const flowOf = (flowStorage: MemoryStorage) =>
  JSON.parse(flowStorage.getItem("oki-admin:login") ?? "null") as {
    verifier: string;
    state: string;
    returnTo: string;
  };

async function loggedIn() {
  const ctx = setup();
  await ctx.session.login("/posts/1");
  const { state } = flowOf(ctx.flowStorage);
  ctx.fetch.mockResolvedValueOnce(
    tokenResponse({ access_token: "A1", id_token: "I1", refresh_token: "R1", expires_in: 3600 }),
  );
  await ctx.session.completeLogin(`?code=abc&state=${state}`);
  ctx.fetch.mockClear();
  return ctx;
}

describe("AuthSession", () => {
  it("redirects to the Cognito authorize endpoint with an S256 challenge", async () => {
    const { session, navigate, flowStorage } = setup();
    await session.login("/posts/1");

    const url = new URL(navigate.mock.calls[0]?.[0] ?? "");
    const flow = flowOf(flowStorage);
    expect(`${url.origin}${url.pathname}`).toBe("https://auth.example.dev/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: "code",
      client_id: "client123",
      redirect_uri: "https://admin.example.dev/",
      scope: "openid email profile",
      code_challenge_method: "S256",
      state: flow.state,
    });
    expect(url.searchParams.get("code_challenge")).toBe(await challengeFor(flow.verifier));
    expect(flow.returnTo).toBe("/posts/1");
  });

  it("ignores a URL that is not a login callback", async () => {
    const { session, fetch } = setup();
    await expect(session.completeLogin("?lang=ja")).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("exchanges the code with the stored verifier and returns the saved path", async () => {
    const { session, flowStorage, fetch } = setup();
    await session.login("/posts/1");
    const flow = flowOf(flowStorage);
    fetch.mockResolvedValueOnce(
      tokenResponse({ access_token: "A1", id_token: "I1", refresh_token: "R1", expires_in: 3600 }),
    );

    await expect(session.completeLogin(`?code=abc&state=${flow.state}`)).resolves.toBe("/posts/1");

    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://auth.example.dev/oauth2/token");
    const body = new URLSearchParams(init.body as URLSearchParams);
    expect(Object.fromEntries(body)).toEqual({
      client_id: "client123",
      grant_type: "authorization_code",
      code: "abc",
      redirect_uri: "https://admin.example.dev/",
      code_verifier: flow.verifier,
    });
    expect(flowStorage.getItem("oki-admin:login")).toBeNull();
    await expect(session.accessToken()).resolves.toBe("A1");
  });

  it("rejects a callback whose state does not match", async () => {
    const { session, fetch } = setup();
    await session.login("/");
    await expect(session.completeLogin("?code=abc&state=forged")).rejects.toThrow(
      "Phiên đăng nhập không hợp lệ",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports an error returned by Cognito", async () => {
    const { session } = setup();
    await expect(
      session.completeLogin("?error=access_denied&error_description=MFA%20required"),
    ).rejects.toThrow("Đăng nhập thất bại: MFA required");
  });

  it("refreshes a token that expires within a minute and keeps the refresh token", async () => {
    const { session, fetch, tick } = await loggedIn();
    tick(3600_000 - 30_000);
    fetch.mockResolvedValueOnce(
      tokenResponse({ access_token: "A2", id_token: "I2", expires_in: 3600 }),
    );

    await expect(session.accessToken()).resolves.toBe("A2");
    const body = formOf(fetch, 0);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("R1");

    tick(3600_000 - 30_000);
    fetch.mockResolvedValueOnce(
      tokenResponse({ access_token: "A3", id_token: "I3", expires_in: 3600 }),
    );
    await session.accessToken();
    const second = formOf(fetch, 1);
    expect(second.get("refresh_token")).toBe("R1");
  });

  it("drops the session when the refresh token is rejected", async () => {
    const { session, fetch, tick } = await loggedIn();
    tick(3600_000);
    fetch.mockResolvedValueOnce(tokenResponse({ error: "invalid_grant" }, 400));

    await expect(session.accessToken()).resolves.toBeNull();
    expect(session.isLoggedIn()).toBe(false);
  });

  it("shares one refresh request between concurrent callers", async () => {
    const { session, fetch } = await loggedIn();
    fetch.mockResolvedValue(
      tokenResponse({ access_token: "A2", id_token: "I2", expires_in: 3600 }),
    );
    await Promise.all([session.refresh(), session.refresh(), session.refresh()]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("logs out through Cognito and forgets the tokens", async () => {
    const { session, navigate } = await loggedIn();
    navigate.mockClear();
    session.logout();
    expect(session.isLoggedIn()).toBe(false);
    const url = new URL(navigate.mock.calls[0]?.[0] ?? "");
    expect(`${url.origin}${url.pathname}`).toBe("https://auth.example.dev/logout");
    expect(url.searchParams.get("client_id")).toBe("client123");
    expect(url.searchParams.get("logout_uri")).toBe("https://admin.example.dev/");
  });
});
