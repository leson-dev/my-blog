import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CfnManagedLoginBranding } from "aws-cdk-lib/aws-cognito";

const DIR = join(import.meta.dirname, "../branding");

/** Cognito colours are RRGGBBAA without "#". */
const rgba = (hex: string) => `${hex.replace("#", "").toLowerCase()}ff`;

/** C1 colours (spec ui-i18n 1.1) applied on top of Cognito's default managed login document. */
export const BRANDING_OVERRIDES: Array<[path: string, value: unknown]> = [
  ["categories.global.colorSchemeMode", "DYNAMIC"],
  ["components.pageBackground.lightMode.color", rgba("#ffffff")],
  ["components.pageBackground.darkMode.color", rgba("#0d1117")],
  ["components.pageBackground.image.enabled", false],
  ["components.form.lightMode.backgroundColor", rgba("#f6f8fa")],
  ["components.form.lightMode.borderColor", rgba("#d0d7de")],
  ["components.form.darkMode.backgroundColor", rgba("#161b22")],
  ["components.form.darkMode.borderColor", rgba("#30363d")],
  ["components.form.logo.enabled", true],
  ["components.primaryButton.lightMode.defaults.backgroundColor", rgba("#1a7f37")],
  ["components.primaryButton.lightMode.defaults.textColor", rgba("#ffffff")],
  ["components.primaryButton.darkMode.defaults.backgroundColor", rgba("#238636")],
  ["components.primaryButton.darkMode.defaults.textColor", rgba("#ffffff")],
  ["components.primaryButton.lightMode.hover.backgroundColor", rgba("#116329")],
  ["components.primaryButton.lightMode.active.backgroundColor", rgba("#116329")],
  ["components.primaryButton.darkMode.hover.backgroundColor", rgba("#2ea043")],
  ["components.primaryButton.darkMode.hover.textColor", rgba("#ffffff")],
  ["components.primaryButton.darkMode.active.backgroundColor", rgba("#2ea043")],
  ["components.primaryButton.darkMode.active.textColor", rgba("#ffffff")],
];

/** Returns a copy of `obj` with `path` set; every segment but the last must already exist. */
export function setPath<T>(obj: T, path: string, value: unknown): T {
  const copy = structuredClone(obj) as Record<string, unknown>;
  const keys = path.split(".");
  let node: Record<string, unknown> = copy;
  keys.slice(0, -1).forEach((key, i) => {
    const next = node[key];
    if (next === null || typeof next !== "object") {
      throw new Error(`branding setting ${keys.slice(0, i + 1).join(".")} does not exist`);
    }
    node = next as Record<string, unknown>;
  });
  const last = keys[keys.length - 1] as string;
  if (!(last in node)) throw new Error(`branding setting ${path} does not exist`);
  node[last] = value;
  return copy as T;
}

const loadDefaults = (): Record<string, unknown> =>
  JSON.parse(readFileSync(join(DIR, "cognito-default-settings.json"), "utf8"));

export function brandingSettings(base: Record<string, unknown> = loadDefaults()) {
  return BRANDING_OVERRIDES.reduce((acc, [path, value]) => setPath(acc, path, value), base);
}

export function brandingAssets(): CfnManagedLoginBranding.AssetTypeProperty[] {
  return (["LIGHT", "DARK"] as const).map((colorMode) => ({
    category: "FORM_LOGO",
    colorMode,
    extension: "SVG",
    bytes: readFileSync(join(DIR, `logo-${colorMode.toLowerCase()}.svg`)).toString("base64"),
  }));
}
