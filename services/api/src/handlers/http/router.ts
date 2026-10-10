import {
  createPostInputSchema,
  createUploadInputSchema,
  type Lang,
  langSchema,
  publishInputSchema,
  putTagInputSchema,
  updatePostInputSchema,
  upsertVersionInputSchema,
} from "@blog/shared";
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { ZodError } from "zod";
import { DomainError } from "../../domain/errors";
import { getLatestBuild, triggerBuild } from "../../usecases/builds";
import type { Deps, Log } from "../../usecases/ports";
import { createPost, deletePost, getPost, listPosts, updatePost } from "../../usecases/posts";
import { publishVersion, unpublishVersion } from "../../usecases/publishing";
import { listTags, putTag } from "../../usecases/tags";
import { createUpload } from "../../usecases/uploads";
import { deleteVersion, upsertVersion } from "../../usecases/versions";
import { isE2EUser } from "./auth";
import { errorResponse, type HttpResult, json, noContent } from "./response";

interface RouteContext {
  deps: Deps;
  /** Required path parameter. */
  param: (name: string) => string;
  /** The `{lang}` path parameter, validated. */
  lang: () => Lang;
  body: unknown;
  caller: { e2e: boolean };
}

interface Route {
  run: (ctx: RouteContext) => Promise<HttpResult>;
  /** The e2e test account must never change what is published. */
  forbiddenForE2E?: boolean;
}

const routes: Record<string, Route> = {
  "GET /posts": { run: async ({ deps }) => json(200, await listPosts(deps)) },
  "POST /posts": {
    run: async ({ deps, body }) =>
      json(201, await createPost(deps, createPostInputSchema.parse(body))),
  },
  "GET /posts/{id}": {
    run: async ({ deps, param }) => json(200, await getPost(deps, param("id"))),
  },
  "PUT /posts/{id}": {
    run: async ({ deps, param, body, caller }) =>
      json(200, await updatePost(deps, param("id"), updatePostInputSchema.parse(body), caller)),
  },
  "DELETE /posts/{id}": {
    run: async ({ deps, param, caller }) => {
      await deletePost(deps, param("id"), caller);
      return noContent();
    },
  },
  "PUT /posts/{id}/versions/{lang}": {
    run: async ({ deps, param, lang, body, caller }) =>
      json(
        200,
        await upsertVersion(
          deps,
          param("id"),
          lang(),
          upsertVersionInputSchema.parse(body),
          caller,
        ),
      ),
  },
  "DELETE /posts/{id}/versions/{lang}": {
    run: async ({ deps, param, lang, caller }) => {
      await deleteVersion(deps, param("id"), lang(), caller);
      return noContent();
    },
  },
  "POST /posts/{id}/versions/{lang}/publish": {
    forbiddenForE2E: true,
    run: async ({ deps, param, lang, body }) =>
      json(
        200,
        await publishVersion(deps, param("id"), lang(), publishInputSchema.parse(body ?? {})),
      ),
  },
  "POST /posts/{id}/versions/{lang}/unpublish": {
    forbiddenForE2E: true,
    run: async ({ deps, param, lang }) =>
      json(200, await unpublishVersion(deps, param("id"), lang())),
  },
  "GET /tags": { run: async ({ deps }) => json(200, await listTags(deps)) },
  "PUT /tags/{key}": {
    run: async ({ deps, param, body, caller }) =>
      json(200, await putTag(deps, param("key"), putTagInputSchema.parse(body), caller)),
  },
  "POST /uploads": {
    run: async ({ deps, body, caller }) =>
      json(200, await createUpload(deps, createUploadInputSchema.parse(body), caller)),
  },
  "GET /builds/latest": { run: async ({ deps }) => json(200, await getLatestBuild(deps)) },
  "POST /builds": {
    forbiddenForE2E: true,
    run: async ({ deps }) => {
      await triggerBuild(deps);
      return json(202, await getLatestBuild(deps));
    },
  },
};

function parseBody(event: APIGatewayProxyEventV2WithJWTAuthorizer): unknown {
  if (!event.body) return undefined;
  const text = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  try {
    return JSON.parse(text);
  } catch {
    throw new DomainError("VALIDATION_ERROR", "request body must be valid JSON");
  }
}

function toErrorResponse(err: unknown, log: Log, requestId: string): HttpResult {
  if (err instanceof DomainError) return errorResponse(err.code, err.message);
  if (err instanceof ZodError) {
    const message = err.issues
      .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
      .join("; ");
    return errorResponse("VALIDATION_ERROR", message);
  }
  log.error("unhandled error", { error: err, requestId });
  return errorResponse("INTERNAL", "internal error");
}

export async function handleHttp(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  deps: Deps,
  log: Log,
): Promise<HttpResult> {
  const route = routes[event.routeKey];
  if (!route) return errorResponse("NOT_FOUND", `no route for ${event.routeKey}`);

  const caller = { e2e: isE2EUser(event) };
  if (route.forbiddenForE2E && caller.e2e) {
    return errorResponse("FORBIDDEN", "the e2e account cannot change what is published");
  }

  try {
    const param = (name: string) => {
      const value = event.pathParameters?.[name];
      if (!value) throw new DomainError("VALIDATION_ERROR", `missing path parameter: ${name}`);
      return value;
    };
    const lang = () => langSchema.parse(param("lang"));
    return await route.run({ deps, param, lang, body: parseBody(event), caller });
  } catch (err) {
    return toErrorResponse(err, log, event.requestContext.requestId);
  }
}
