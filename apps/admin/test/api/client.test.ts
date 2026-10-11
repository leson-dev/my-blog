// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { ApiError, type Auth, createApiClient, errorMessage } from "../../src/api/client";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function setup(tokens: Array<string | null> = ["T1"]) {
  const queue = [...tokens];
  const auth = {
    accessToken: vi.fn(async () => (queue.length > 1 ? queue.shift() : queue[0]) ?? null),
    refresh: vi.fn(async (): Promise<"ok" | "invalid" | "unavailable"> => "ok"),
    login: vi.fn(async (_returnTo: string) => {}),
  } satisfies Auth;
  const fetch = vi.fn<typeof globalThis.fetch>();
  const client = createApiClient({
    baseUrl: "https://api.example.dev",
    auth,
    fetch,
    currentPath: () => "/posts/1",
  });
  return { auth, fetch, client };
}

describe("createApiClient", () => {
  it("sends the access token and a JSON body, and parses the JSON reply", async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValueOnce(json(201, { id: "p1" }));

    await expect(client.request("POST", "/posts", { title: "x" })).resolves.toEqual({ id: "p1" });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.dev/posts");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      authorization: "Bearer T1",
      "content-type": "application/json",
    });
    expect(init.body).toBe('{"title":"x"}');
  });

  it("returns undefined for 204", async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(client.request("DELETE", "/posts/p1")).resolves.toBeUndefined();
  });

  it("turns the API error body into an ApiError", async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValueOnce(
      json(409, { error: { code: "SLUG_TAKEN", message: "slug taken" } }),
    );
    const err = await client.request("PUT", "/posts/p1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: "SLUG_TAKEN" });
  });

  it("refreshes once on 401 and retries with the new token", async () => {
    const { client, fetch, auth } = setup(["T1", "T2"]);
    fetch.mockResolvedValueOnce(json(401, { message: "Unauthorized" }));
    fetch.mockResolvedValueOnce(json(200, []));

    await expect(client.request("GET", "/posts")).resolves.toEqual([]);
    expect(auth.refresh).toHaveBeenCalledOnce();
    const retry = fetch.mock.calls[1]?.[1] as RequestInit;
    expect((retry.headers as Record<string, string>).authorization).toBe("Bearer T2");
  });

  it("sends the user to login (once) when the refresh fails", async () => {
    const { client, fetch, auth } = setup();
    auth.refresh.mockResolvedValueOnce("invalid");
    fetch.mockResolvedValueOnce(json(401, {}));

    await expect(client.request("GET", "/posts")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(auth.login).toHaveBeenCalledExactlyOnceWith("/posts/1");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("reports a network problem, without logging out, when the refresh cannot reach Cognito", async () => {
    const { client, fetch, auth } = setup();
    auth.refresh.mockResolvedValueOnce("unavailable");
    fetch.mockResolvedValueOnce(json(401, {}));

    await expect(client.request("GET", "/posts")).rejects.toMatchObject({ code: "NETWORK" });
    expect(auth.login).not.toHaveBeenCalled();
  });

  it("sends the user to login without calling the API when there is no token", async () => {
    const { client, fetch, auth } = setup([null]);
    await expect(client.request("GET", "/posts")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(auth.login).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports network failures", async () => {
    const { client, fetch } = setup();
    fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(client.request("GET", "/posts")).rejects.toMatchObject({ code: "NETWORK" });
  });
});

describe("errorMessage", () => {
  it("speaks Vietnamese for known API errors", () => {
    expect(errorMessage(new ApiError(409, "SLUG_TAKEN", "x"))).toBe("Slug này đã có bài khác dùng");
    expect(errorMessage(new ApiError(400, "VALIDATION_ERROR", "title: too long"))).toBe(
      "Dữ liệu không hợp lệ: title: too long",
    );
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });
});
