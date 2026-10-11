import type { PostSummary } from "@blog/shared";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { errorMessage } from "../api/client";
import { Layout } from "../components/Layout";
import { useServices } from "../context";
import { formatLocal } from "../lib/format";
import { displayTitle, filterPosts, type StatusFilter, versionBadges } from "../lib/posts";
import { NewPostDialog } from "./NewPostDialog";

export function PostListPage() {
  const { api } = useServices();
  const [posts, setPosts] = useState<PostSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let alive = true;
    api.listPosts().then(
      (list) => {
        if (alive) setPosts(list);
      },
      (err: unknown) => {
        if (alive) setError(errorMessage(err));
      },
    );
    return () => {
      alive = false;
    };
  }, [api]);

  const visible = useMemo(
    () => (posts ? filterPosts(posts, { status, query }) : []),
    [posts, status, query],
  );

  return (
    <Layout crumbs={[{ label: "bài viết" }]}>
      <div className="toolbar">
        <label>
          Trạng thái{" "}
          <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
            <option value="all">tất cả</option>
            <option value="draft">nháp</option>
            <option value="scheduled">hẹn giờ</option>
            <option value="published">đã đăng</option>
          </select>
        </label>
        <input
          type="search"
          aria-label="Tìm theo tiêu đề"
          placeholder="tìm theo tiêu đề…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
          + Bài mới
        </button>
      </div>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      {posts === null && !error ? <p className="muted">đang tải…</p> : null}
      {posts !== null && visible.length === 0 ? <p className="muted">Không có bài nào.</p> : null}
      <ul className="post-list">
        {visible.map((post) => (
          <li key={post.id}>
            <Link to={`/posts/${post.id}`} className="post-title">
              {displayTitle(post)}
            </Link>
            {versionBadges(post).map((badge) => (
              <span key={badge.lang} className={`badge status-${badge.status ?? "none"}`}>
                {badge.text}
              </span>
            ))}
            {post.tags.map((tag) => (
              <span key={tag} className="tags-text">
                #{tag}
              </span>
            ))}
            <time dateTime={post.updatedAt}>{formatLocal(post.updatedAt)}</time>
          </li>
        ))}
      </ul>
      {creating ? <NewPostDialog onClose={() => setCreating(false)} /> : null}
    </Layout>
  );
}
