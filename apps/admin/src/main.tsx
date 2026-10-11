import "@blog/ui-tokens/fonts.css";
import "@blog/ui-tokens/tokens.css";
import "./styles/admin.css";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { browserSessionDeps } from "./auth/session";
import { bootstrap } from "./bootstrap";
import { loadConfig } from "./config";
import { ServicesProvider } from "./context";

const root = createRoot(document.getElementById("root") as HTMLElement);
root.render(<p className="boot">~/oki-dev/admin$ đang khởi động…</p>);

const result = await bootstrap({
  loadConfig: () => loadConfig(),
  sessionDeps: browserSessionDeps(),
  location: { pathname: location.pathname, search: location.search },
  replaceUrl: (path) => history.replaceState(null, "", path),
  fetch: globalThis.fetch.bind(globalThis),
  currentPath: () => `${location.pathname}${location.search}`,
});

if (result.kind === "ready") {
  root.render(
    <BrowserRouter>
      <ServicesProvider value={result.services}>
        <App />
      </ServicesProvider>
    </BrowserRouter>,
  );
} else if (result.kind === "redirecting") {
  root.render(<p className="boot">Đang chuyển tới trang đăng nhập…</p>);
} else {
  root.render(<p className="fatal error">Lỗi khởi động: {result.message}</p>);
}
