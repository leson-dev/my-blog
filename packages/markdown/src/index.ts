import rehypeShiki from "@shikijs/rehype";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { lazyImages } from "./lazyImages";

export { readingMinutes } from "./readingTime";

function createProcessor() {
  return (
    unified()
      .use(remarkParse)
      .use(remarkGfm)
      // allowDangerousHtml stays off: raw HTML in Markdown is dropped here.
      // remark-rehype prefixes footnote ids *and* hrefs with "user-content-"; raw HTML is gone,
      // so sanitize must not add the prefix a second time (it only rewrites ids, not hrefs).
      .use(remarkRehype)
      // Sanitize before highlighting so Shiki's inline styles are not stripped.
      .use(rehypeSanitize, { ...defaultSchema, clobberPrefix: "" })
      .use(rehypeSlug)
      .use(lazyImages)
      .use(rehypeShiki, {
        themes: { light: "github-light", dark: "github-dark" },
        defaultColor: "light",
        fallbackLanguage: "text",
      })
      .use(rehypeStringify)
  );
}

let processor: ReturnType<typeof createProcessor> | undefined;

/** Markdown -> sanitized HTML. The processor (and its Shiki highlighter) is created once. */
export async function renderMarkdown(markdown: string): Promise<string> {
  processor ??= createProcessor();
  return String(await processor.process(markdown));
}
