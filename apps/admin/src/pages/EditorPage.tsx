import { LANGS, type Lang, LIMITS, type Tag, type TagSummary } from "@blog/shared";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { errorMessage } from "../api/client";
import { useBuild } from "../build/BuildProvider";
import { Layout } from "../components/Layout";
import { useServices } from "../context";
import { ConflictDialog } from "../editor/ConflictDialog";
import { CreateVersionDialog } from "../editor/CreateVersionDialog";
import { InfoPanel } from "../editor/InfoPanel";
import { MarkdownEditor, type MarkdownEditorHandle } from "../editor/MarkdownEditor";
import { Preview } from "../editor/Preview";
import { PublishButton } from "../editor/PublishButton";
import { ScheduleDialog } from "../editor/ScheduleDialog";
import { AUTOSAVE_DELAY_MS, useAutosave } from "../editor/useAutosave";
import { usePostEditor } from "../editor/usePostEditor";
import { altFromFileName, imageMarkdown } from "../lib/image";
import { displayTitle, pickLang, STATUS_LABEL } from "../lib/posts";
import type { PublishAction } from "../lib/publish";
import { loadZone, saveZone, type ZoneKey } from "../lib/zones";

export function EditorPage({
  id,
  autosaveDelayMs = AUTOSAVE_DELAY_MS,
}: {
  id: string;
  autosaveDelayMs?: number;
}) {
  const { api, uploadImage } = useServices();
  const build = useBuild();
  const editor = usePostEditor(api, id, () => void build.refresh());
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [chosen, setChosen] = useState<Lang | null>(null);
  const [zone, setZone] = useState<ZoneKey>(() => loadZone());
  const [infoOpen, setInfoOpen] = useState(false);
  const [pane, setPane] = useState<"write" | "preview">("write");
  const [creating, setCreating] = useState<Lang | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [knownTags, setKnownTags] = useState<TagSummary[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const editorRef = useRef<MarkdownEditorHandle>(null);

  const post = editor.post;
  const lang =
    chosen && post?.versions[chosen]
      ? chosen
      : post
        ? pickLang(post, searchParams.get("lang"))
        : null;
  const version = post && lang ? post.versions[lang] : undefined;
  const draft = lang ? editor.drafts[lang] : undefined;

  const flush = useAutosave(
    draft,
    Boolean(draft?.dirty && version && version.status !== "published"),
    () => {
      if (lang) void editor.saveVersion(lang);
    },
    autosaveDelayMs,
  );

  useEffect(() => {
    api.listTags().then(setKnownTags, () => setKnownTags([]));
  }, [api]);

  const anyDirty = Object.values(editor.drafts).some((d) => d?.dirty);
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [anyDirty]);

  if (!post || !lang || !version || !draft) {
    return (
      <Layout crumbs={[{ label: "bài viết", to: "/" }, { label: "…" }]}>
        {editor.error ? (
          <p role="alert" className="error">
            {editor.error}
          </p>
        ) : (
          <p className="muted">đang tải…</p>
        )}
      </Layout>
    );
  }

  const selectLang = (next: Lang) => {
    flush();
    setChosen(next);
    setSearchParams({ lang: next }, { replace: true });
  };

  async function onPublishAction(action: PublishAction) {
    if (!lang) return;
    switch (action) {
      case "publish":
      case "publishNow":
        await editor.publish(lang);
        break;
      case "schedule":
        setScheduling(true);
        break;
      case "unschedule":
        await editor.unpublish(lang);
        break;
      case "update":
        await editor.saveVersion(lang);
        break;
      case "unpublish":
        if (window.confirm(`Gỡ bản ${lang} khỏi site?`)) await editor.unpublish(lang);
        break;
    }
  }

  async function onImageFiles(files: File[]) {
    for (const file of files) {
      setNotice(`Đang tải ảnh ${file.name}…`);
      try {
        const url = await uploadImage(file);
        editorRef.current?.insertAtCursor(`${imageMarkdown(url, altFromFileName(file.name))}\n`);
        setNotice(null);
      } catch (err) {
        setNotice(errorMessage(err));
      }
    }
  }

  async function onCreateTag(key: string, names: Tag["names"]) {
    await api.putTag(key, names);
    setKnownTags(await api.listTags());
  }

  return (
    <Layout
      crumbs={[{ label: "bài viết", to: "/" }, { label: displayTitle(post) }]}
      savedAt={editor.savedAt}
      actions={
        <>
          <PublishButton
            lang={lang}
            version={version}
            zone={zone}
            dirty={draft.dirty}
            busy={editor.saving}
            onAction={(action) => void onPublishAction(action)}
          />
          <button
            type="button"
            className="info-toggle"
            aria-label="Thông tin bài"
            aria-expanded={infoOpen}
            onClick={() => setInfoOpen((o) => !o)}
          >
            ⚙
          </button>
        </>
      }
    >
      <div className="lang-tabs" role="tablist" aria-label="Bản ngôn ngữ">
        {LANGS.map((l) => {
          const v = post.versions[l];
          return v ? (
            <button
              key={l}
              type="button"
              role="tab"
              aria-selected={l === lang}
              className="lang-tab"
              onClick={() => selectLang(l)}
            >
              {l}{" "}
              <span className={`status-${v.status}`}>{v.status === "published" ? "●" : "○"}</span>{" "}
              {STATUS_LABEL[v.status]}
            </button>
          ) : (
            <button key={l} type="button" className="lang-tab" onClick={() => setCreating(l)}>
              + Tạo bản {l}
            </button>
          );
        })}
        <span className="saving">
          {editor.saving ? "đang lưu…" : draft.dirty ? "chưa lưu" : ""}
        </span>
      </div>

      {editor.error ? (
        <p role="alert" className="error">
          {editor.error}{" "}
          <button type="button" className="btn-link" onClick={editor.dismissError}>
            đóng
          </button>
        </p>
      ) : null}
      {notice ? <p className="muted">{notice}</p> : null}

      <div className="pane-tabs" role="tablist" aria-label="Khung">
        <button
          type="button"
          role="tab"
          aria-selected={pane === "write"}
          onClick={() => setPane("write")}
        >
          Soạn
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={pane === "preview"}
          onClick={() => setPane("preview")}
        >
          Xem trước
        </button>
      </div>

      <div className="editor-grid" data-pane={pane} data-info-open={infoOpen}>
        <section className="col-write" aria-label="Soạn" lang={lang}>
          <input
            className="title-input"
            aria-label="Tiêu đề"
            value={draft.title}
            maxLength={LIMITS.titleMax}
            onChange={(e) => editor.edit(lang, { title: e.target.value })}
          />
          <MarkdownEditor
            key={lang}
            ref={editorRef}
            value={draft.content}
            onChange={(content) => editor.edit(lang, { content })}
            onImageFiles={(files) => void onImageFiles(files)}
          />
        </section>
        <section className="col-preview" aria-label="Xem trước" lang={lang}>
          <Preview title={draft.title} markdown={draft.content} />
        </section>
        <aside className="col-info" aria-label="Thông tin">
          <InfoPanel
            post={post}
            lang={lang}
            draft={draft}
            knownTags={knownTags}
            onEdit={(patch) => editor.edit(lang, patch)}
            onSaveShared={editor.saveShared}
            onCreateTag={onCreateTag}
            onDeleteVersion={() => {
              const remaining = LANGS.find((l) => l !== lang && post.versions[l]);
              void editor.deleteVersion(lang).then((ok) => {
                if (ok && remaining) selectLang(remaining);
              });
            }}
            onDeletePost={() => {
              void editor.deletePost().then((ok) => {
                if (ok) navigate("/");
              });
            }}
            onUpload={uploadImage}
          />
        </aside>
      </div>

      {creating ? (
        <CreateVersionDialog
          lang={creating}
          onCancel={() => setCreating(null)}
          onCreate={async (title) => {
            if (await editor.createVersion(creating, title)) {
              setCreating(null);
              selectLang(creating);
            }
          }}
        />
      ) : null}
      {scheduling ? (
        <ScheduleDialog
          lang={lang}
          initialIso={version.publishAt}
          zone={zone}
          onZoneChange={(z) => {
            setZone(z);
            saveZone(z);
          }}
          onCancel={() => setScheduling(false)}
          onSubmit={(iso) => {
            setScheduling(false);
            void editor.publish(lang, iso);
          }}
        />
      ) : null}
      {editor.conflict ? (
        <ConflictDialog
          onReload={() => void editor.resolveConflict("reload")}
          onOverwrite={() => void editor.resolveConflict("overwrite")}
        />
      ) : null}
    </Layout>
  );
}
