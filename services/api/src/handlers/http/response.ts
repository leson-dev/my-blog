import type { ApiErrorBody, ErrorCode } from "@blog/shared";
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

export type HttpResult = APIGatewayProxyStructuredResultV2;

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  SLUG_TAKEN: 409,
  INVALID_STATE: 409,
  INTERNAL: 500,
};

export const json = (statusCode: number, body: unknown): HttpResult => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const noContent = (): HttpResult => ({ statusCode: 204 });

export const errorResponse = (code: ErrorCode, message: string): HttpResult =>
  json(STATUS[code], { error: { code, message } } satisfies ApiErrorBody);
