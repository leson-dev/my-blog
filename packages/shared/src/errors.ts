export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "FORBIDDEN",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "SLUG_TAKEN",
  "INVALID_STATE",
  "INTERNAL",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string };
}
