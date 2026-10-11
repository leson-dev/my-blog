import { LIMITS, slugify, type Tag, type TagSummary } from "@blog/shared";
import { type KeyboardEvent, useId, useState } from "react";

const tagName = (key: string, known: TagSummary[]) => {
  const tag = known.find((t) => t.key === key);
  return tag?.names.vi ?? tag?.names.ja ?? key;
};

export function TagInput({
  value,
  known,
  onChange,
  onCreateTag,
}: {
  value: string[];
  known: TagSummary[];
  onChange: (tags: string[]) => void;
  onCreateTag: (key: string, names: Tag["names"]) => Promise<void>;
}) {
  const listId = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ key: string; vi: string; ja: string } | null>(null);

  function add() {
    const raw = text.trim();
    if (raw === "") return;
    const key = slugify(raw);
    if (key === "") {
      setError("Tag phải có ít nhất một chữ Latin hoặc chữ số");
      return;
    }
    setError(null);
    setText("");
    if (value.includes(key)) return;
    if (known.some((t) => t.key === key)) onChange([...value, key]);
    else setPending({ key, vi: raw, ja: "" });
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    }
  }

  async function confirmNew() {
    if (!pending) return;
    const names: Tag["names"] = {};
    if (pending.vi.trim()) names.vi = pending.vi.trim();
    if (pending.ja.trim()) names.ja = pending.ja.trim();
    if (names.vi || names.ja) await onCreateTag(pending.key, names);
    onChange([...value, pending.key]);
    setPending(null);
  }

  return (
    <div className="tag-input">
      <div className="chips">
        {value.map((key) => (
          <span key={key} className="chip">
            #{tagName(key, known)}
            <button
              type="button"
              aria-label={`Bỏ tag ${tagName(key, known)}`}
              onClick={() => onChange(value.filter((k) => k !== key))}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        aria-label="Thêm tag"
        list={listId}
        placeholder="thêm tag, Enter"
        maxLength={LIMITS.tagMax}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <datalist id={listId}>
        {known.map((t) => (
          <option key={t.key} value={t.key}>
            {[t.names.vi, t.names.ja].filter(Boolean).join(" / ")}
          </option>
        ))}
      </datalist>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      {pending ? (
        <div className="new-tag">
          <p className="muted">
            Tag mới <code>{pending.key}</code>
          </p>
          <label>
            Tên vi
            <input
              value={pending.vi}
              maxLength={LIMITS.tagNameMax}
              onChange={(e) => setPending({ ...pending, vi: e.target.value })}
            />
          </label>
          <label>
            Tên ja
            <input
              value={pending.ja}
              maxLength={LIMITS.tagNameMax}
              onChange={(e) => setPending({ ...pending, ja: e.target.value })}
            />
          </label>
          <div className="dialog-actions">
            <button type="button" onClick={() => setPending(null)}>
              Huỷ
            </button>
            <button type="button" className="btn-primary" onClick={() => void confirmNew()}>
              Thêm tag mới
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
