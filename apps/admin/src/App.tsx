import { Link, Route, Routes, useParams } from "react-router";
import { BuildProvider } from "./build/BuildProvider";
import { Layout } from "./components/Layout";
import { EditorPage } from "./pages/EditorPage";
import { PostListPage } from "./pages/PostListPage";
import { TagsPage } from "./pages/TagsPage";

function NotFound() {
  return (
    <Layout crumbs={[{ label: "404" }]}>
      <p>
        Không có trang này. <Link to="/">Về danh sách bài</Link>
      </p>
    </Layout>
  );
}

function EditorRoute() {
  const { id = "" } = useParams();
  return <EditorPage key={id} id={id} />;
}

export function App() {
  return (
    <BuildProvider>
      <Routes>
        <Route path="/" element={<PostListPage />} />
        <Route path="/posts/:id" element={<EditorRoute />} />
        <Route path="/tags" element={<TagsPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BuildProvider>
  );
}
