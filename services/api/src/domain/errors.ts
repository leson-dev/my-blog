import type { ErrorCode } from "@blog/shared";

export class DomainError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

export const notFound = (what: string): DomainError =>
  new DomainError("NOT_FOUND", `${what} not found`);
