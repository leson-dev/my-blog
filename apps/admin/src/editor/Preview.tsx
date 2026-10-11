import { renderMarkdown } from "@blog/markdown";
import { useDeferredValue, useEffect, useState } from "react";

export const PREVIEW_DELAY_MS = 250;

/** The article as the public site renders it (same @blog/markdown pipeline, same prose CSS). */
export function Preview({
  title,
  markdown,
  render = renderMarkdown,
}: {
  title: string;
  markdown: string;
  render?: (md: string) => Promise<string>;
}) {
  const deferred = useDeferredValue(markdown);
  const [html, setHtml] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      render(deferred).then(
        (out) => {
          if (!alive) return;
          setHtml(out);
          setError(null);
        },
        (err: unknown) => {
          if (alive) setError(err instanceof Error ? err.message : String(err));
        },
      );
    }, PREVIEW_DELAY_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [deferred, render]);

  return (
    <article className="preview prose">
      <h1>{title}</h1>
      {error ? (
        <p role="alert" className="error">
          Lỗi xem trước: {error}
        </p>
      ) : null}
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: output of the sanitizing pipeline shared with the public site */}
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  );
}
