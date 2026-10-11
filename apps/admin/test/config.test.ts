import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config";

const valid = {
  region: "ap-northeast-1",
  apiUrl: "https://api.example.dev",
  userPoolId: "ap-northeast-1_abc",
  userPoolClientId: "client123",
  cognitoDomain: "https://auth.example.dev",
  redirectUri: "https://admin.example.dev/",
};

const respond = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("loadConfig", () => {
  it("reads /config.json without the HTTP cache", async () => {
    const fetchImpl = respond(200, valid);
    await expect(loadConfig(fetchImpl)).resolves.toEqual(valid);
    expect(fetchImpl).toHaveBeenCalledWith("/config.json", { cache: "no-store" });
  });

  it("rejects a config with a missing field", async () => {
    const { apiUrl: _apiUrl, ...partial } = valid;
    await expect(loadConfig(respond(200, partial))).rejects.toThrow();
  });

  it("reports the HTTP status when config.json is missing", async () => {
    await expect(loadConfig(respond(404, {}))).rejects.toThrow("config.json: HTTP 404");
  });
});
