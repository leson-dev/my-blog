import type { ReactNode } from "react";
import { Link } from "react-router";
import { buildLabel, useBuild } from "../build/BuildProvider";
import { useServices } from "../context";
import { formatClock } from "../lib/format";

export interface Crumb {
  label: string;
  to?: string;
}

export function Layout({
  crumbs = [],
  savedAt = null,
  actions,
  children,
}: {
  crumbs?: Crumb[];
  savedAt?: string | null;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const build = useBuild();
  const { auth } = useServices();
  const label = buildLabel(build.state);

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="logo">
          ~/oki-dev/admin$
        </Link>
        <nav className="crumbs" aria-label="Vị trí">
          {crumbs.map((crumb) => (
            <span key={crumb.label}>
              {" / "}
              {crumb.to ? <Link to={crumb.to}>{crumb.label}</Link> : crumb.label}
            </span>
          ))}
        </nav>
        <span
          className={`build build-${label.tone}`}
          title={build.state?.error ?? build.error ?? undefined}
        >
          {label.text}
        </span>
        <button
          type="button"
          className="btn-link"
          disabled={label.tone === "busy"}
          onClick={() => void build.rebuild()}
        >
          Build lại
        </button>
        {savedAt ? <span className="saved">đã lưu {formatClock(savedAt)}</span> : null}
        <span className="spacer" />
        {actions}
        <Link to="/tags">tags</Link>
        <button type="button" className="btn-link" onClick={() => auth.logout()}>
          đăng xuất
        </button>
      </header>
      <main className="main">{children}</main>
    </div>
  );
}
