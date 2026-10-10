import {
  createPostInputSchema,
  createUploadInputSchema,
  publishInputSchema,
  updatePostInputSchema,
} from "@blog/shared";
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { ZodError } from "zod";
import { DomainError } from "../../domain/errors";
import { getLatestBuild, triggerBuild } from "../../usecases/builds";
import type { Deps } from "../../usecases/ports";
import { createPost, deletePost, getPost, listPosts, updatePost } from "../../usecases/posts";
import { publishPost, unpublishPost } from "../../usecases/publishing";
import { createUpload } from "../../usecases/uploads";
import { isE2EUser } from "./auth";
import { errorResponse, type HttpResult, json, noContent } from "./response";

export interface Log {
  error(message: string, attributes: Record<string, unknown>): void;
}

interface RouteContext {
  deps: Deps;
  id: () => string;
  body: unknown;
  e2e: boolean;
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
  "GET /posts/{id}": { run: async ({ deps, id }) => json(200, await getPost(deps, id())) },
  "PUT /posts/{id}": {
    run: async ({ deps, id, body }) =>
      json(200, await updatePost(deps, id(), updatePostInputSchema.parse(body))),
  },
  "DELETE /posts/{id}": {
    run: async ({ deps, id }) => {
      await deletePost(deps, id());
      return noContent();
    },
  },
  "POST /posts/{id}/publish": {
    forbiddenForE2E: true,
    run: async ({ deps, id, body }) =>
      json(200, await publishPost(deps, id(), publishInputSchema.parse(body ?? {}))),
  },
  "POST /posts/{id}/unpublish": {
    forbiddenForE2E: true,
    run: async ({ deps, id }) => json(200, await unpublishPost(deps, id())),
  },
  "POST /uploads": {
    run: async ({ deps, body, e2e }) =>
      json(200, await createUpload(deps, createUploadInputSchema.parse(body), { e2e })),
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

  const e2e = isE2EUser(event);
  if (route.forbiddenForE2E && e2e) {
    return errorResponse("FORBIDDEN", "the e2e account cannot change what is published");
  }

  try {
    const id = () => {
      const value = event.pathParameters?.id;
      if (!value) throw new DomainError("VALIDATION_ERROR", "missing path parameter: id");
      return value;
    };
    return await route.run({ deps, id, body: parseBody(event), e2e });
  } catch (err) {
    return toErrorResponse(err, log, event.requestContext.requestId);
  }
}
