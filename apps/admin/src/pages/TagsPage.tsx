import { LANGS, type Lang, LIMITS, type Tag, type TagSummary } from "@blog/shared";
import { useEffect, useState } from "react";
import { errorMessage } from "../api/client";
import { Layout } from "../components/Layout";
import { useServices } from "../context";

type RowState = { names: Record<Lang, string>; status: "idle" | "saving" | "saved" | string };

const namesOf = (tag: TagSummary): Record<Lang, string> => ({
  vi: tag.names.vi ?? "",
  ja: tag.names.ja ?? "",
});

export function TagsPage() {
  const { api } = useServices();
  const [tags, setTags] = useState<TagSummary[] | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listTags().then(
      (list) => {
        const sorted = list.toSorted((a, b) => a.key.localeCompare(b.key));
        setTags(sorted);
        setRows(
          Object.fromEntries(sorted.map((t) => [t.key, { names: namesOf(t), status: "idle" }])),
        );
      },
      (err: unknown) => setError(errorMessage(err)),
    );
  }, [api]);

  const setRow = (key: string, patch: Partial<RowState>) =>
    setRows((all) => {
      const row = all[key];
      return row ? { ...all, [key]: { ...row, ...patch } } : all;
    });

  async function save(tag: TagSummary) {
    const row = rows[tag.key];
    if (!row) return;
    const before = namesOf(tag);
    if (LANGS.every((l) => row.names[l].trim() === before[l])) return;
    const names: Tag["names"] = {};
    for (const l of LANGS) if (row.names[l].trim()) names[l] = row.names[l].trim();
    setRow(tag.key, { status: "saving" });
    try {
      const saved = await api.putTag(tag.key, names);
      setTags(
        (list) => list?.map((t) => (t.key === tag.key ? { ...t, names: saved.names } : t)) ?? null,
      );
      setRow(tag.key, { status: "saved" });
    } catch (err) {
      setRow(tag.key, { status: errorMessage(err) });
    }
  }

  return (
    <Layout crumbs={[{ label: "tags" }]}>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      {tags === null && !error ? <p className="muted">đang tải…</p> : null}
      {tags !== null && tags.length === 0 ? <p className="muted">Chưa có tag nào.</p> : null}
      {tags && tags.length > 0 ? (
        <table className="tags-table">
          <thead>
            <tr>
              <th scope="col">khóa</th>
              <th scope="col">tên vi</th>
              <th scope="col">tên ja</th>
              <th scope="col">số bài</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {tags.map((tag) => {
              const row = rows[tag.key];
              return (
                <tr key={tag.key}>
                  <th scope="row">{tag.key}</th>
                  {LANGS.map((l) => (
                    <td key={l} data-label={`tên ${l}`}>
                      <input
                        aria-label={`Tên ${l} của ${tag.key}`}
                        placeholder={`tên ${l}`}
                        lang={l}
                        maxLength={LIMITS.tagNameMax}
                        value={row?.names[l] ?? ""}
                        onChange={(e) =>
                          setRow(tag.key, {
                            names: { ...(row?.names ?? namesOf(tag)), [l]: e.target.value },
                            status: "idle",
                          })
                        }
                        onBlur={() => void save(tag)}
                      />
                    </td>
                  ))}
                  <td data-label="số bài:">{tag.postCount}</td>
                  <td className="muted">
                    {row?.status === "saving"
                      ? "đang lưu…"
                      : row?.status === "saved"
                        ? "đã lưu"
                        : row?.status === "idle"
                          ? ""
                          : row?.status}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </Layout>
  );
}
