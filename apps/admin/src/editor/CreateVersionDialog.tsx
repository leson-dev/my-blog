import { type Lang, LIMITS } from "@blog/shared";
import { type FormEvent, useState } from "react";
import { Dialog } from "../components/Dialog";

export function CreateVersionDialog({
  lang,
  onCancel,
  onCreate,
}: {
  lang: Lang;
  onCancel: () => void;
  onCreate: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    await onCreate(title.trim());
    setBusy(false);
  }

  return (
    <Dialog title={`Tạo bản ${lang}`} onClose={onCancel}>
      <form onSubmit={submit}>
        <label>
          Tiêu đề bản {lang}
          <input
            value={title}
            maxLength={LIMITS.titleMax}
            required
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            Huỷ
          </button>
          <button type="submit" className="btn-primary" disabled={busy || title.trim() === ""}>
            Tạo bản {lang}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
