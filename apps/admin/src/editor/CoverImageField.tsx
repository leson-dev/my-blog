import { useEffect, useId, useState } from "react";

/** Same rule as the API schema: a /media/ path or an https URL. */
export const isValidCover = (url: string) => /^(\/media\/|https:\/\/)/.test(url);

export function CoverImageField({
  value,
  onSave,
  onUpload,
}: {
  value: string | null;
  onSave: (url: string | null) => void;
  onUpload?: (file: File) => Promise<string>;
}) {
  const fileId = useId();
  const [text, setText] = useState(value ?? "");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => setText(value ?? ""), [value]);

  function commit(next: string) {
    const url = next.trim();
    if (url === (value ?? "")) return;
    if (url !== "" && !isValidCover(url)) {
      setError("Ảnh bìa phải là đường dẫn /media/… hoặc URL https://");
      return;
    }
    setError(null);
    onSave(url === "" ? null : url);
  }

  async function upload(file: File | undefined) {
    if (!file || !onUpload) return;
    setUploading(true);
    setError(null);
    try {
      const url = await onUpload(file);
      setText(url);
      onSave(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="cover">
      <label>
        Ảnh bìa (URL)
        <input
          value={text}
          placeholder="https://… hoặc /media/…"
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
        />
      </label>
      {onUpload ? (
        <label htmlFor={fileId} className="btn-link">
          {uploading ? "đang tải ảnh…" : "Tải ảnh lên"}
          <input
            id={fileId}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => void upload(e.target.files?.[0])}
          />
        </label>
      ) : null}
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      {value ? <img className="cover-preview" src={value} alt="Ảnh bìa" /> : null}
    </div>
  );
}
