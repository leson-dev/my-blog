import type { Root } from "hast";
import { visit } from "unist-util-visit";

/** Adds loading="lazy" and decoding="async" to every <img>. */
export function lazyImages() {
  return (tree: Root) => {
    visit(tree, "element", (node) => {
      if (node.tagName === "img") {
        node.properties.loading = "lazy";
        node.properties.decoding = "async";
      }
    });
  };
}
