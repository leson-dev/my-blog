import { Link, Route, Routes } from "react-router";
import { BuildProvider } from "./build/BuildProvider";
import { Layout } from "./components/Layout";
import { PostListPage } from "./pages/PostListPage";

function Placeholder({ title }: { title: string }) {
  return (
    <Layout crumbs={[{ label: title }]}>
      <p className="muted">Đang xây dựng.</p>
    </Layout>
  );
}

function NotFound() {
  return (
    <Layout crumbs={[{ label: "404" }]}>
      <p>
        Không có trang này. <Link to="/">Về danh sách bài</Link>
      </p>
    </Layout>
  );
}

export function App() {
  return (
    <BuildProvider>
      <Routes>
        <Route path="/" element={<PostListPage />} />
        <Route path="/posts/:id" element={<Placeholder title="soạn bài" />} />
        <Route path="/tags" element={<Placeholder title="tags" />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BuildProvider>
  );
}
