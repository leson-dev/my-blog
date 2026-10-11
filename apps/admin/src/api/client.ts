import type { ApiErrorBody, ErrorCode } from "@blog/shared";

export type ApiErrorCode = ErrorCode | "UNAUTHORIZED" | "NETWORK";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;

  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export interface Auth {
  accessToken(): Promise<string | null>;
  refresh(): Promise<boolean>;
  login(returnTo: string): Promise<void>;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface ApiClient {
  request<T>(method: HttpMethod, path: string, body?: unknown): Promise<T>;
}

export interface ApiClientOptions {
  baseUrl: string;
  auth: Auth;
  fetch: typeof fetch;
  /** Where to come back to after a forced login. */
  currentPath: () => string;
}

export function createApiClient(opts: ApiClientOptions): ApiClient {
  const send = (method: HttpMethod, path: string, body: unknown, token: string) =>
    opts.fetch(`${opts.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const unauthorized = async (): Promise<never> => {
    await opts.auth.login(opts.currentPath());
    throw new ApiError(401, "UNAUTHORIZED", "Phiên đăng nhập đã hết hạn");
  };

  async function call(method: HttpMethod, path: string, body: unknown): Promise<Response> {
    const token = await opts.auth.accessToken();
    if (!token) return unauthorized();
    const res = await send(method, path, body, token);
    if (res.status !== 401) return res;

    if (!(await opts.auth.refresh())) return unauthorized();
    const fresh = await opts.auth.accessToken();
    if (!fresh) return unauthorized();
    const retried = await send(method, path, body, fresh);
    return retried.status === 401 ? unauthorized() : retried;
  }

  return {
    async request<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
      let res: Response;
      try {
        res = await call(method, path, body);
      } catch (err) {
        if (err instanceof ApiError) throw err;
        throw new ApiError(0, "NETWORK", "Không kết nối được tới API");
      }
      if (res.status === 204) return undefined as T;
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const error = (data as Partial<ApiErrorBody> | null)?.error;
        throw new ApiError(
          res.status,
          error?.code ?? "INTERNAL",
          error?.message ?? `HTTP ${res.status}`,
        );
      }
      return data as T;
    },
  };
}

const MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  VERSION_CONFLICT: "Bài vừa được sửa ở nơi khác",
  SLUG_TAKEN: "Slug này đã có bài khác dùng",
  INVALID_STATE: "Thao tác không hợp lệ với trạng thái hiện tại",
  FORBIDDEN: "Tài khoản không có quyền làm việc này",
  NOT_FOUND: "Không tìm thấy",
  NETWORK: "Không kết nối được tới API",
  INTERNAL: "Lỗi máy chủ, thử lại sau",
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "VALIDATION_ERROR") return `Dữ liệu không hợp lệ: ${err.message}`;
    return MESSAGES[err.code] ?? err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
