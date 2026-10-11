import { LANGS, type Lang, LIMITS } from "@blog/shared";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { errorMessage } from "../api/client";
import { Dialog } from "../components/Dialog";
import { useServices } from "../context";

export function NewPostDialog({ onClose }: { onClose: () => void }) {
  const { api } = useServices();
  const navigate = useNavigate();
  const [lang, setLang] = useState<Lang>("vi");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const post = await api.createPost({ lang, title: title.trim() });
      navigate(`/posts/${post.id}?lang=${lang}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Dialog title="Bài mới" onClose={onClose}>
      <form onSubmit={submit}>
        <fieldset>
          <legend>Viết bản nào trước?</legend>
          {LANGS.map((l) => (
            <label key={l}>
              <input
                type="radio"
                name="lang"
                value={l}
                checked={lang === l}
                onChange={() => setLang(l)}
              />{" "}
              {l}
            </label>
          ))}
        </fieldset>
        <label>
          Tiêu đề
          <input
            value={title}
            maxLength={LIMITS.titleMax}
            required
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        {error ? (
          <p role="alert" className="error">
            {error}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Huỷ
          </button>
          <button type="submit" className="btn-primary" disabled={busy || title.trim() === ""}>
            Tạo
          </button>
        </div>
      </form>
    </Dialog>
  );
}
