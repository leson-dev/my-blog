import { type Lang, LIMITS, type Post, type Tag, type TagSummary } from "@blog/shared";
import { CoverImageField } from "./CoverImageField";
import { TagInput } from "./TagInput";
import { type Draft, type EditableField, slugToSend } from "./usePostEditor";

export function InfoPanel({
  post,
  lang,
  draft,
  knownTags,
  onEdit,
  onSaveShared,
  onCreateTag,
  onDeleteVersion,
  onDeletePost,
  onUpload,
}: {
  post: Post;
  lang: Lang;
  draft: Draft;
  knownTags: TagSummary[];
  onEdit: (patch: Partial<Pick<Draft, EditableField>>) => void;
  onSaveShared: (input: { tags: string[]; coverImage: string | null }) => Promise<boolean>;
  onCreateTag: (key: string, names: Tag["names"]) => Promise<void>;
  onDeleteVersion: () => void;
  onDeletePost: () => void;
  onUpload?: (file: File) => Promise<string>;
}) {
  const version = post.versions[lang];
  const followsTitle = !draft.slugTouched && !version?.publishedAt;
  const shownSlug = draft.slugTouched ? draft.slug : (slugToSend(version, draft) ?? draft.slug);
  const onlyVersion = Object.keys(post.versions).length === 1;

  return (
    <>
      <h3>— riêng bản {lang} —</h3>
      <label>
        Slug
        <input
          value={shownSlug}
          maxLength={LIMITS.slugMax}
          onChange={(e) => onEdit({ slug: e.target.value })}
        />
      </label>
      {followsTitle ? <span className="muted">tự theo tiêu đề</span> : null}
      <label>
        Tóm tắt
        <textarea
          rows={4}
          value={draft.excerpt}
          maxLength={LIMITS.excerptMax}
          onChange={(e) => onEdit({ excerpt: e.target.value })}
        />
      </label>

      <h3>— chung cả bài —</h3>
      <TagInput
        value={post.tags}
        known={knownTags}
        onChange={(tags) => void onSaveShared({ tags, coverImage: post.coverImage })}
        onCreateTag={onCreateTag}
      />
      <CoverImageField
        value={post.coverImage}
        onSave={(coverImage) => void onSaveShared({ tags: post.tags, coverImage })}
        onUpload={onUpload}
      />

      <div className="danger-zone">
        <button
          type="button"
          className="btn-danger"
          disabled={onlyVersion}
          title={onlyVersion ? "Bài phải còn ít nhất một bản" : undefined}
          onClick={() => {
            if (window.confirm(`Xoá bản ${lang} của bài này?`)) onDeleteVersion();
          }}
        >
          Xoá bản {lang}
        </button>
        <button
          type="button"
          className="btn-danger"
          onClick={() => {
            if (window.confirm("Xoá cả bài (mọi bản ngôn ngữ)? Không hoàn tác được."))
              onDeletePost();
          }}
        >
          Xoá cả bài
        </button>
      </div>
    </>
  );
}
