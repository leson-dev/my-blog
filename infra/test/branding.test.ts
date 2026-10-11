import { describe, expect, it } from "vitest";
import { BRANDING_OVERRIDES, brandingAssets, brandingSettings, setPath } from "../lib/branding";

const get = (obj: unknown, path: string) =>
  path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);

describe("Cognito managed login branding (C1)", () => {
  it("only overrides settings that exist in Cognito's own document", () => {
    const settings = brandingSettings();
    for (const [path, value] of BRANDING_OVERRIDES) {
      expect(get(settings, path), path).toEqual(value);
    }
  });

  it("uses the C1 dark background and follows the OS colour scheme", () => {
    const settings = brandingSettings();
    expect(get(settings, "components.pageBackground.darkMode.color")).toBe("0d1117ff");
    expect(get(settings, "categories.global.colorSchemeMode")).toBe("DYNAMIC");
  });

  it("refuses an override path that does not exist", () => {
    expect(() => setPath({ a: { b: 1 } }, "a.c.d", 2)).toThrow("a.c");
  });

  it("ships the ~/oki-dev$ logo for light and dark mode", () => {
    const assets = brandingAssets();
    expect(assets.map((a) => [a.category, a.colorMode, a.extension])).toEqual([
      ["FORM_LOGO", "LIGHT", "SVG"],
      ["FORM_LOGO", "DARK", "SVG"],
    ]);
    expect(Buffer.from(assets[0]?.bytes ?? "", "base64").toString()).toContain("~/oki-dev$");
  });
  it("keeps the logo within Cognito's 1:1 to 4:1 width:height limit", () => {
    for (const asset of brandingAssets()) {
      const svg = Buffer.from(asset.bytes ?? "", "base64").toString();
      const width = Number(/width="([\d.]+)"/.exec(svg)?.[1]);
      const height = Number(/height="([\d.]+)"/.exec(svg)?.[1]);
      expect(width / height, asset.colorMode).toBeGreaterThanOrEqual(1);
      expect(width / height, asset.colorMode).toBeLessThanOrEqual(4);
    }
  });
});
