import type { Lang, LangVersion } from "@blog/shared";
import { useState } from "react";
import { type PublishAction, publishMenu } from "../lib/publish";
import type { ZoneKey } from "../lib/zones";

export function PublishButton({
  lang,
  version,
  zone,
  dirty,
  busy,
  onAction,
}: {
  lang: Lang;
  version: LangVersion;
  zone: ZoneKey;
  dirty: boolean;
  busy: boolean;
  onAction: (action: PublishAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const menu = publishMenu(lang, version, zone);
  const primaryDisabled = busy || (menu.primary.action === "update" && !dirty);

  return (
    <div className="publish">
      <button
        type="button"
        className="btn-primary"
        disabled={primaryDisabled}
        onClick={() => onAction(menu.primary.action)}
      >
        {menu.primary.label}
      </button>
      <button
        type="button"
        className="btn-primary menu-toggle"
        aria-label="Thêm thao tác đăng"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
      >
        ▾
      </button>
      {open ? (
        <div className="menu">
          {menu.menu.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                setOpen(false);
                onAction(item.action);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
