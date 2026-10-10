import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import { groupsOf } from "../../src/handlers/http/auth";
import { handleHttp } from "../../src/handlers/http/router";
import { makeDeps } from "../fakes";

const httpEvent = (
  routeKey: string,
  opts: { body?: unknown; rawBody?: string; id?: string; groups?: unknown } = {},
) =>
  ({
    routeKey,
    pathParameters: opts.id ? { id: opts.id } : undefined,
    body: opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    isBase64Encoded: false,
    requestContext: {
      requestId: "req-1",
      authorizer: {
        jwt: {
          claims: opts.groups === undefined ? {} : { "cognito:groups": opts.groups },
          scopes: [],
        },
      },
    },
  }) as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;

const log = () => ({ error: vi.fn() });
const parse = (res: { body?: string }) => JSON.parse(res.body ?? "null");

describe("handleHttp", () => {
  it("creates a post (201) and reads it back (200)", async () => {
    const deps = makeDeps();
    const created = await handleHttp(
      httpEvent("POST /posts", { body: { title: "Học AWS" } }),
      deps,
      log(),
    );
    expect(created.statusCode).toBe(201);
    const { id } = parse(created);
    const read = await handleHttp(httpEvent("GET /posts/{id}", { id }), deps, log());
    expect(read.statusCode).toBe(200);
    expect(parse(read).slug).toBe("hoc-aws");
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await handleHttp(httpEvent("POST /posts", { rawBody: "{oops" }), makeDeps(), log());
    expect(res.statusCode).toBe(400);
    expect(parse(res).error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 with the failing field for schema errors", async () => {
    const res = await handleHttp(
      httpEvent("POST /posts", { body: { title: "" } }),
      makeDeps(),
      log(),
    );
    expect(res.statusCode).toBe(400);
    expect(parse(res).error.message).toContain("title");
  });

  it("returns 404 for an unknown post and for an unknown route", async () => {
    const deps = makeDeps();
    expect(
      (await handleHttp(httpEvent("GET /posts/{id}", { id: "x" }), deps, log())).statusCode,
    ).toBe(404);
    expect((await handleHttp(httpEvent("GET /nope"), deps, log())).statusCode).toBe(404);
  });

  it("returns 409 SLUG_TAKEN for a duplicate slug", async () => {
    const deps = makeDeps();
    await handleHttp(httpEvent("POST /posts", { body: { title: "Same" } }), deps, log());
    const res = await handleHttp(
      httpEvent("POST /posts", { body: { title: "Same" } }),
      deps,
      log(),
    );
    expect(res.statusCode).toBe(409);
    expect(parse(res).error.code).toBe("SLUG_TAKEN");
  });

  it("forbids the e2e group from publishing and leaves the post unchanged", async () => {
    const deps = makeDeps();
    const { id } = parse(
      await handleHttp(httpEvent("POST /posts", { body: { title: "T" } }), deps, log()),
    );
    const res = await handleHttp(
      httpEvent("POST /posts/{id}/publish", { id, body: {}, groups: "[e2e]" }),
      deps,
      log(),
    );
    expect(res.statusCode).toBe(403);
    expect(parse(res).error.code).toBe("FORBIDDEN");
    expect((await deps.posts.get(id))?.status).toBe("draft");
    expect(deps.buildQueue.reasons).toEqual([]);
  });

  it.each(["POST /posts/{id}/unpublish", "POST /builds"])("forbids e2e on %s", async (routeKey) => {
    const res = await handleHttp(
      httpEvent(routeKey, { id: "x", groups: "[e2e]" }),
      makeDeps(),
      log(),
    );
    expect(res.statusCode).toBe(403);
  });

  it("puts e2e uploads under media/e2e/", async () => {
    const res = await handleHttp(
      httpEvent("POST /uploads", { body: { contentType: "image/png" }, groups: "[e2e]" }),
      makeDeps(),
      log(),
    );
    expect(res.statusCode).toBe(200);
    expect(parse(res).key).toMatch(/^media\/e2e\//);
  });

  it("returns 202 with the queued state for a manual build", async () => {
    const res = await handleHttp(httpEvent("POST /builds"), makeDeps(), log());
    expect(res.statusCode).toBe(202);
    expect(parse(res).status).toBe("queued");
  });

  it("hides unexpected errors behind a 500 and logs them", async () => {
    const deps = makeDeps();
    deps.posts.list = () => Promise.reject(new Error("secret internals"));
    const sink = log();
    const res = await handleHttp(httpEvent("GET /posts"), deps, sink);
    expect(res.statusCode).toBe(500);
    expect(parse(res).error).toEqual({ code: "INTERNAL", message: "internal error" });
    expect(sink.error).toHaveBeenCalledOnce();
  });
});

describe("groupsOf", () => {
  it.each([
    [undefined, []],
    ["[e2e]", ["e2e"]],
    ["[admin e2e]", ["admin", "e2e"]],
    ["e2e", ["e2e"]],
    [
      ["admin", "e2e"],
      ["admin", "e2e"],
    ],
  ])("parses %j", (groups, expected) => {
    expect(groupsOf(httpEvent("GET /posts", { groups }))).toEqual(expected);
  });
});
