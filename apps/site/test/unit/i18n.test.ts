import { describe, expect, it } from "vitest";
import { t } from "../../src/i18n";
import { ja } from "../../src/i18n/ja";
import { vi } from "../../src/i18n/vi";

describe("i18n dictionaries", () => {
  it("have exactly the same keys", () => {
    expect(Object.keys(ja).sort()).toEqual(Object.keys(vi).sort());
  });

  it("picks the dictionary by UI language", () => {
    expect(t("vi")["nav.search"]).toBe("tìm kiếm");
    expect(t("ja")["nav.search"]).toBe("検索");
  });

  it("formats reading time and the single-language notice", () => {
    expect(t("vi")["post.minutes"](3)).toBe("3 phút đọc");
    expect(t("ja")["post.minutes"](3)).toBe("3分で読めます");
    expect(t("ja")["post.onlyIn"]("vi")).toBe("この記事はベトナム語のみです。");
    expect(t("vi")["post.onlyIn"]("ja")).toBe("Bài này chỉ có bản tiếng Nhật.");
  });
});
