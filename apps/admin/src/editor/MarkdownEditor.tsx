import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { Annotation, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { type Ref, useEffect, useImperativeHandle, useRef } from "react";

export interface MarkdownEditorHandle {
  insertAtCursor(text: string): void;
  focus(): void;
}

/** CodeMirror's built-in theme is light-only (black caret); follow the C1 tokens instead. */
const c1Theme = EditorView.theme({
  ".cm-content": { caretColor: "var(--fg-strong)" },
});

/** Marks programmatic document replacements so they are not reported as typing. */
const external = Annotation.define<boolean>();

const imageFiles = (list: FileList | null | undefined): File[] =>
  Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));

export function MarkdownEditor({
  value,
  onChange,
  onImageFiles,
  ref,
}: {
  value: string;
  onChange: (value: string) => void;
  onImageFiles?: (files: File[]) => void;
  ref?: Ref<MarkdownEditorHandle>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onImagesRef = useRef(onImageFiles);
  onImagesRef.current = onImageFiles;

  useEffect(() => {
    const v = new EditorView({
      parent: host.current as HTMLDivElement,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          c1Theme,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": "Nội dung Markdown" }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((t) => t.annotation(external))) {
              onChangeRef.current(u.state.doc.toString());
            }
          }),
          EditorView.domEventHandlers({
            paste: (e) => {
              const files = imageFiles(e.clipboardData?.files);
              if (files.length === 0 || !onImagesRef.current) return false;
              e.preventDefault();
              onImagesRef.current(files);
              return true;
            },
            drop: (e, editor) => {
              const files = imageFiles(e.dataTransfer?.files);
              if (files.length === 0 || !onImagesRef.current) return false;
              e.preventDefault();
              const pos = editor.posAtCoords({ x: e.clientX, y: e.clientY });
              if (pos !== null) editor.dispatch({ selection: { anchor: pos } });
              onImagesRef.current(files);
              return true;
            },
          }),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
  }, []);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({
        changes: { from: 0, to: v.state.doc.length, insert: value },
        annotations: external.of(true),
      });
    }
  }, [value]);

  useImperativeHandle(ref, () => ({
    insertAtCursor(text: string) {
      const v = view.current;
      if (!v) return;
      const { from, to } = v.state.selection.main;
      v.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
      });
      v.focus();
    },
    focus() {
      view.current?.focus();
    },
  }));

  return <div ref={host} className="cm-host" />;
}
