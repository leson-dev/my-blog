import "@blog/ui-tokens/fonts.css";
import "@blog/ui-tokens/tokens.css";
import "@blog/ui-tokens/prose.css";
import "./styles/admin.css";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
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
  // A data router (rather than <BrowserRouter>) so the editor can block in-app navigation.
  const router = createBrowserRouter([
    {
      path: "*",
      element: (
        <ServicesProvider value={result.services}>
          <App />
        </ServicesProvider>
      ),
    },
  ]);
  root.render(<RouterProvider router={router} />);
} else if (result.kind === "redirecting") {
  root.render(<p className="boot">Đang chuyển tới trang đăng nhập…</p>);
} else {
  root.render(<p className="fatal error">Lỗi khởi động: {result.message}</p>);
}
