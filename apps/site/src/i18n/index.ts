import type { Lang } from "@blog/shared";
import { ja } from "./ja";
import { type Dict, vi } from "./vi";

export type { Dict };

export const t = (ui: Lang): Dict => (ui === "ja" ? ja : vi);
