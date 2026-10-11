import { createApiClient } from "./api/client";
import { endpoints } from "./api/endpoints";
import { AuthSession, type SessionDeps } from "./auth/session";
import type { AdminConfig } from "./config";
import type { Services } from "./context";
import { uploadImage } from "./lib/image";

export interface BootEnv {
  loadConfig: () => Promise<AdminConfig>;
  sessionDeps: SessionDeps;
  location: { pathname: string; search: string };
  replaceUrl: (path: string) => void;
  fetch: typeof fetch;
  currentPath: () => string;
}

export type BootResult =
  | { kind: "ready"; services: Services }
  | { kind: "redirecting" }
  | { kind: "error"; message: string };

/** Config → finish a login callback → make sure there is a session → build the services. */
export async function bootstrap(env: BootEnv): Promise<BootResult> {
  try {
    const config = await env.loadConfig();
    const auth = new AuthSession(config, env.sessionDeps);
    const returnTo = await auth.completeLogin(env.location.search);
    if (returnTo !== null) env.replaceUrl(returnTo);
    if (!auth.isLoggedIn()) {
      await auth.login(returnTo ?? `${env.location.pathname}${env.location.search}`);
      return { kind: "redirecting" };
    }
    const client = createApiClient({
      baseUrl: config.apiUrl,
      auth,
      fetch: env.fetch,
      currentPath: env.currentPath,
    });
    const api = endpoints(client);
    return {
      kind: "ready",
      services: { api, auth, uploadImage: (file) => uploadImage(api, file) },
    };
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }
}
