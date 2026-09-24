import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { THEMES, ThemeProvider } from "../ThemeProvider";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("themes", () => {
  it("offers only day and night", () => {
    expect(THEMES.map((t) => t.id)).toEqual(["day", "night"]);
  });

  it("falls back to day when night-vision was saved", () => {
    window.localStorage.setItem("mfp.theme", "night-vision");
    render(
      <ThemeProvider>
        <div />
      </ThemeProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe("day");
    expect(window.localStorage.getItem("mfp.theme")).toBe("day");
  });
});

// Reads the real tokens from styles.css so a palette edit that breaks legibility fails here.
function themeTokens(css: string, selector: RegExp): Record<string, number[]> {
  const block = css.match(selector)?.[1] ?? "";
  const tokens: Record<string, number[]> = {};
  for (const m of block.matchAll(/--([\w-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)) {
    tokens[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return tokens;
}

function luminance([r, g, b]: number[]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: number[], b: number[]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("token contrast (WCAG AA, 4.5:1)", () => {
  const css = readFileSync(resolve(__dirname, "../../styles.css"), "utf-8");
  const themes = {
    day: themeTokens(css, /:root,\s*\[data-theme="day"\]\s*\{([^}]*)\}/),
    night: themeTokens(css, /\[data-theme="night"\]\s*\{([^}]*)\}/),
  };
  const pairs: Array<[string, string]> = [
    ["ink-500", "surface"],
    ["ink-500", "canvas"],
    ["ink-600", "surface"],
    ["ink-700", "surface"],
    ["ink-900", "surface"],
    ["on-brand", "brand-600"],
    ["success-fg", "success-surface"],
    ["warning-fg", "warning-surface"],
    ["danger-fg", "danger-surface"],
  ];
  for (const [name, tokens] of Object.entries(themes)) {
    for (const [fg, bg] of pairs) {
      it(`${name}: ${fg} on ${bg}`, () => {
        expect(tokens[fg], `--${fg} missing in ${name}`).toBeDefined();
        expect(tokens[bg], `--${bg} missing in ${name}`).toBeDefined();
        expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
