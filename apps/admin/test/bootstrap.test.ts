// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { bootstrap } from "../src/bootstrap";
import type { AdminConfig } from "../src/config";
import { MemoryStorage } from "./memoryStorage";

const config: AdminConfig = {
  region: "ap-northeast-1",
  apiUrl: "https://api.example.dev",
  userPoolId: "pool",
  userPoolClientId: "client123",
  cognitoDomain: "https://auth.example.dev",
  redirectUri: "https://admin.example.dev/",
};

function env(location: { pathname: string; search: string }) {
  const storage = new MemoryStorage();
  const flowStorage = new MemoryStorage();
  const navigate = vi.fn<(url: string) => void>();
  const fetch = vi.fn<typeof globalThis.fetch>();
  const replaceUrl = vi.fn<(path: string) => void>();
  return {
    storage,
    flowStorage,
    navigate,
    fetch,
    replaceUrl,
    bootEnv: {
      loadConfig: async () => config,
      sessionDeps: { fetch, storage, flowStorage, navigate, now: () => 0 },
      location,
      replaceUrl,
      fetch,
      currentPath: () => location.pathname,
    },
  };
}

describe("bootstrap", () => {
  it("sends a visitor without a session to the login page, remembering the path", async () => {
    const e = env({ pathname: "/posts/1", search: "?lang=ja" });
    await expect(bootstrap(e.bootEnv)).resolves.toEqual({ kind: "redirecting" });
    expect(e.navigate).toHaveBeenCalledOnce();
    expect(JSON.parse(e.flowStorage.getItem("oki-admin:login") ?? "{}").returnTo).toBe(
      "/posts/1?lang=ja",
    );
  });

  it("finishes the login callback, restores the path and starts the app", async () => {
    const e = env({ pathname: "/", search: "" });
    e.flowStorage.setItem(
      "oki-admin:login",
      JSON.stringify({ verifier: "v", state: "s", returnTo: "/tags" }),
    );
    e.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: "A", id_token: "I", refresh_token: "R", expires_in: 3600 }),
      ),
    );
    const result = await bootstrap({
      ...e.bootEnv,
      location: { pathname: "/", search: "?code=c&state=s" },
    });
    expect(result.kind).toBe("ready");
    expect(e.replaceUrl).toHaveBeenCalledWith("/tags");
  });

  it("reports a broken config", async () => {
    const e = env({ pathname: "/", search: "" });
    const result = await bootstrap({
      ...e.bootEnv,
      loadConfig: async () => {
        throw new Error("config.json: HTTP 404");
      },
    });
    expect(result).toEqual({ kind: "error", message: "config.json: HTTP 404" });
  });
});
