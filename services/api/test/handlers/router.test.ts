import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import { groupsOf } from "../../src/handlers/http/auth";
import { handleHttp } from "../../src/handlers/http/router";
import { makeDeps } from "../fakes";

type Params = Record<string, string>;

const httpEvent = (
  routeKey: string,
  opts: { body?: unknown; rawBody?: string; params?: Params; groups?: unknown } = {},
) =>
  ({
    routeKey,
    pathParameters: opts.params,
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

const createVi = async (deps: ReturnType<typeof makeDeps>, title = "Học AWS") =>
  parse(await handleHttp(httpEvent("POST /posts", { body: { lang: "vi", title } }), deps, log()));

describe("posts and versions", () => {
  it("creates a post (201), adds a ja version and reads both back", async () => {
    const deps = makeDeps();
    const created = await handleHttp(
      httpEvent("POST /posts", { body: { lang: "vi", title: "Học AWS" } }),
      deps,
      log(),
    );
    expect(created.statusCode).toBe(201);
    const { id, version } = parse(created);
    const put = await handleHttp(
      httpEvent("PUT /posts/{id}/versions/{lang}", {
        params: { id, lang: "ja" },
        body: { title: "AWSを学ぶ", excerpt: "", content: "本文", version },
      }),
      deps,
      log(),
    );
    expect(put.statusCode).toBe(200);
    const read = parse(
      await handleHttp(httpEvent("GET /posts/{id}", { params: { id } }), deps, log()),
    );
    expect(Object.keys(read.versions)).toEqual(["vi", "ja"]);
  });

  it("rejects an unknown language with 400", async () => {
    const deps = makeDeps();
    const { id } = await createVi(deps);
    const res = await handleHttp(
      httpEvent("POST /posts/{id}/versions/{lang}/publish", {
        params: { id, lang: "en" },
        body: {},
      }),
      deps,
      log(),
    );
    expect(res.statusCode).toBe(400);
    expect(parse(res).error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 409 when deleting the only version and 204 when deleting the post", async () => {
    const deps = makeDeps();
    const { id } = await createVi(deps);
    const delVersion = await handleHttp(
      httpEvent("DELETE /posts/{id}/versions/{lang}", { params: { id, lang: "vi" } }),
      deps,
      log(),
    );
    expect(delVersion.statusCode).toBe(409);
    const delPost = await handleHttp(
      httpEvent("DELETE /posts/{id}", { params: { id } }),
      deps,
      log(),
    );
    expect(delPost.statusCode).toBe(204);
  });

  it("publishes one language and updates shared fields", async () => {
    const deps = makeDeps();
    const { id } = await createVi(deps);
    const pub = parse(
      await handleHttp(
        httpEvent("POST /posts/{id}/versions/{lang}/publish", {
          params: { id, lang: "vi" },
          body: {},
        }),
        deps,
        log(),
      ),
    );
    expect(pub.versions.vi.status).toBe("published");
    const shared = await handleHttp(
      httpEvent("PUT /posts/{id}", {
        params: { id },
        body: { tags: ["Life"], coverImage: null, version: pub.version },
      }),
      deps,
      log(),
    );
    expect(parse(shared).tags).toEqual(["life"]);
  });

  it("returns 400 for malformed JSON, 404 for unknown posts and routes, 409 for a duplicate slug", async () => {
    const deps = makeDeps();
    expect(
      (await handleHttp(httpEvent("POST /posts", { rawBody: "{oops" }), deps, log())).statusCode,
    ).toBe(400);
    expect(
      (await handleHttp(httpEvent("GET /posts/{id}", { params: { id: "x" } }), deps, log()))
        .statusCode,
    ).toBe(404);
    expect((await handleHttp(httpEvent("GET /nope"), deps, log())).statusCode).toBe(404);
    await createVi(deps, "Same");
    const dup = await handleHttp(
      httpEvent("POST /posts", { body: { lang: "vi", title: "Same" } }),
      deps,
      log(),
    );
    expect(parse(dup).error.code).toBe("SLUG_TAKEN");
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

describe("tags", () => {
  it("lists tags and renames one", async () => {
    const deps = makeDeps();
    await handleHttp(
      httpEvent("POST /posts", { body: { lang: "vi", title: "A", tags: ["life"] } }),
      deps,
      log(),
    );
    const put = await handleHttp(
      httpEvent("PUT /tags/{key}", { params: { key: "life" }, body: { names: { ja: "暮らし" } } }),
      deps,
      log(),
    );
    expect(put.statusCode).toBe(200);
    const list = parse(await handleHttp(httpEvent("GET /tags"), deps, log()));
    expect(list).toEqual([{ key: "life", names: { ja: "暮らし" }, postCount: 1 }]);
  });
});

describe("e2e account", () => {
  it.each([
    ["POST /posts/{id}/versions/{lang}/publish", { id: "x", lang: "vi" }],
    ["POST /posts/{id}/versions/{lang}/unpublish", { id: "x", lang: "vi" }],
    ["POST /builds", {}],
  ])("is forbidden on %s", async (routeKey, params) => {
    const res = await handleHttp(
      httpEvent(routeKey, { params, groups: "[e2e]" }),
      makeDeps(),
      log(),
    );
    expect(res.statusCode).toBe(403);
  });

  it("may edit a draft-only post but not one with a published version", async () => {
    const deps = makeDeps();
    const draft = await createVi(deps, "Draft");
    const ok = await handleHttp(
      httpEvent("PUT /posts/{id}/versions/{lang}", {
        params: { id: draft.id, lang: "vi" },
        body: { title: "Draft 2", excerpt: "", content: "", version: draft.version },
        groups: "[e2e]",
      }),
      deps,
      log(),
    );
    expect(ok.statusCode).toBe(200);

    const live = await createVi(deps, "Live");
    const pub = parse(
      await handleHttp(
        httpEvent("POST /posts/{id}/versions/{lang}/publish", {
          params: { id: live.id, lang: "vi" },
          body: {},
        }),
        deps,
        log(),
      ),
    );
    for (const [routeKey, params, body] of [
      ["PUT /posts/{id}", { id: live.id }, { tags: [], coverImage: null, version: pub.version }],
      [
        "PUT /posts/{id}/versions/{lang}",
        { id: live.id, lang: "ja" },
        { title: "x", excerpt: "", content: "", version: pub.version },
      ],
      ["DELETE /posts/{id}", { id: live.id }, undefined],
    ] as const) {
      const res = await handleHttp(
        httpEvent(routeKey, { params, body, groups: "[e2e]" }),
        deps,
        log(),
      );
      expect(res.statusCode).toBe(403);
    }
  });

  it("puts uploads under media/e2e/", async () => {
    const res = await handleHttp(
      httpEvent("POST /uploads", { body: { contentType: "image/png" }, groups: "[e2e]" }),
      makeDeps(),
      log(),
    );
    expect(parse(res).key).toMatch(/^media\/e2e\//);
  });
});

describe("groupsOf", () => {
  it.each([
    [undefined, []],
    ["[e2e]", ["e2e"]],
    ["[admin e2e]", ["admin", "e2e"]],
    [
      ["admin", "e2e"],
      ["admin", "e2e"],
    ],
  ])("parses %j", (groups, expected) => {
    expect(groupsOf(httpEvent("GET /posts", { groups }))).toEqual(expected);
  });
});
