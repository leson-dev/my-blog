import type { AdminConfig } from "../config";
import { challengeFor, randomVerifier } from "./pkce";

export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface SessionDeps {
  fetch: typeof fetch;
  /** Tokens; survives browser restarts so the 30-day refresh token avoids a new MFA login. */
  storage: KeyValueStore;
  /** PKCE verifier + state for one login round trip. */
  flowStorage: KeyValueStore;
  navigate: (url: string) => void;
  now: () => number;
}

interface Tokens {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface LoginFlow {
  verifier: string;
  state: string;
  returnTo: string;
}

interface TokenResponse {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  expires_in: number;
}

const TOKENS_KEY = "oki-admin:tokens";
const FLOW_KEY = "oki-admin:login";
const EXPIRY_MARGIN_MS = 60_000;

export class AuthSession {
  private readonly config: AdminConfig;
  private readonly deps: SessionDeps;
  private refreshing: Promise<boolean> | undefined;

  constructor(config: AdminConfig, deps: SessionDeps) {
    this.config = config;
    this.deps = deps;
  }

  async login(returnTo: string): Promise<void> {
    const flow: LoginFlow = { verifier: randomVerifier(), state: randomVerifier(), returnTo };
    this.deps.flowStorage.setItem(FLOW_KEY, JSON.stringify(flow));
    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.config.userPoolClientId,
      redirect_uri: this.config.redirectUri,
      scope: "openid email profile",
      state: flow.state,
      code_challenge: await challengeFor(flow.verifier),
      code_challenge_method: "S256",
    });
    this.deps.navigate(`${this.config.cognitoDomain}/oauth2/authorize?${params}`);
  }

  /** Finishes a login redirect. Returns the path to go back to, or null if `search` is not a callback. */
  async completeLogin(search: string): Promise<string | null> {
    const params = new URLSearchParams(search);
    const code = params.get("code");
    const error = params.get("error");
    if (code === null && error === null) return null;

    const raw = this.deps.flowStorage.getItem(FLOW_KEY);
    this.deps.flowStorage.removeItem(FLOW_KEY);
    if (error !== null) {
      throw new Error(`Đăng nhập thất bại: ${params.get("error_description") ?? error}`);
    }
    const flow = raw ? (JSON.parse(raw) as LoginFlow) : null;
    if (code === null || flow === null || flow.state !== params.get("state")) {
      throw new Error("Phiên đăng nhập không hợp lệ, hãy đăng nhập lại");
    }
    const res = await this.tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.config.redirectUri,
      code_verifier: flow.verifier,
    });
    this.store(res);
    return flow.returnTo;
  }

  /** A usable access token (refreshed when it expires within a minute), or null: log in again. */
  async accessToken(): Promise<string | null> {
    const tokens = this.load();
    if (!tokens) return null;
    if (tokens.expiresAt - EXPIRY_MARGIN_MS > this.deps.now()) return tokens.accessToken;
    if (!(await this.refresh())) return null;
    return this.load()?.accessToken ?? null;
  }

  /** Uses the refresh token; on failure the session is dropped. Concurrent callers share one request. */
  refresh(): Promise<boolean> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  isLoggedIn(): boolean {
    return this.load() !== null;
  }

  logout(): void {
    this.deps.storage.removeItem(TOKENS_KEY);
    const params = new URLSearchParams({
      client_id: this.config.userPoolClientId,
      logout_uri: this.config.redirectUri,
    });
    this.deps.navigate(`${this.config.cognitoDomain}/logout?${params}`);
  }

  private async doRefresh(): Promise<boolean> {
    const tokens = this.load();
    if (!tokens) return false;
    try {
      const res = await this.tokenRequest({
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
      });
      this.store(res, tokens.refreshToken);
      return true;
    } catch {
      this.deps.storage.removeItem(TOKENS_KEY);
      return false;
    }
  }

  private async tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
    const res = await this.deps.fetch(`${this.config.cognitoDomain}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.config.userPoolClientId, ...body }),
    });
    if (!res.ok) throw new Error(`token endpoint: HTTP ${res.status}`);
    return (await res.json()) as TokenResponse;
  }

  private store(res: TokenResponse, previousRefreshToken?: string): void {
    const refreshToken = res.refresh_token ?? previousRefreshToken;
    if (!refreshToken) throw new Error("token endpoint returned no refresh token");
    const tokens: Tokens = {
      accessToken: res.access_token,
      idToken: res.id_token,
      refreshToken,
      expiresAt: this.deps.now() + res.expires_in * 1000,
    };
    this.deps.storage.setItem(TOKENS_KEY, JSON.stringify(tokens));
  }

  private load(): Tokens | null {
    const raw = this.deps.storage.getItem(TOKENS_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Tokens;
    } catch {
      return null;
    }
  }
}

export const browserSessionDeps = (): SessionDeps => ({
  fetch: globalThis.fetch.bind(globalThis),
  storage: localStorage,
  flowStorage: sessionStorage,
  navigate: (url) => location.assign(url),
  now: () => Date.now(),
});
