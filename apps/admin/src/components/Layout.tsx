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
        <div className="topbar-main">
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
            title={build.state?.error ?? build.error ?? label.text}
          >
            {label.text}
          </span>
          <button
            type="button"
            className="btn-link"
            aria-label="Build lại"
            disabled={label.tone === "busy"}
            onClick={() => void build.rebuild()}
          >
            <span className="label-wide">Build lại</span>
            <span className="label-narrow" aria-hidden="true">
              ↻
            </span>
          </button>
          {savedAt ? <span className="saved">đã lưu {formatClock(savedAt)}</span> : null}
          <span className="spacer" />
          <Link to="/tags">tags</Link>
          <button type="button" className="btn-link" onClick={() => auth.logout()}>
            đăng xuất
          </button>
        </div>
        {/* Page actions (publish, ⚙): a second row of their own on phones. */}
        {actions ? <div className="topbar-actions">{actions}</div> : null}
      </header>
      <main className="main">{children}</main>
    </div>
  );
}
