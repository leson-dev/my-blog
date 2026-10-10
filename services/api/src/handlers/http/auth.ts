import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";

/**
 * HTTP API JWT authorizers flatten array claims into strings such as "[admin e2e]".
 */
export function groupsOf(event: APIGatewayProxyEventV2WithJWTAuthorizer): string[] {
  const raw: unknown = event.requestContext.authorizer?.jwt?.claims?.["cognito:groups"];
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) return raw.map(String);
  return String(raw)
    .replace(/^\[|\]$/g, "")
    .split(/[\s,]+/)
    .filter(Boolean);
}

export const isE2EUser = (event: APIGatewayProxyEventV2WithJWTAuthorizer): boolean =>
  groupsOf(event).includes("e2e");
