/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { CONTROLS, TAB_ROUTES, type ControlTab } from "../controls";
import { getHelpModule } from "../registry";
import { flattenTopics } from "../topicUtils";

const ID_PREFIX: Record<ControlTab, string> = {
  lcms: "lcms.",
  ftir: "ftir.",
  "plate-reader": "plate.",
  ai: "ai.",
  app: "app.",
};

const sources = import.meta.glob("../../**/*.tsx", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;

// Ids the UI marks: <Hint id="…"> and dataControl="…".
function usedIds(): Map<string, string> {
  const used = new Map<string, string>();
  for (const [file, text] of Object.entries(sources)) {
    if (file.includes("__tests__")) continue;
    for (const m of text.matchAll(/<Hint\b[^>]*?\bid="([^"]+)"|dataControl="([^"]+)"/g)) {
      used.set(m[1] ?? m[2], file);
    }
  }
  return used;
}

describe("control registry", () => {
  it("has unique ids with the tab's prefix", () => {
    const ids = CONTROLS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CONTROLS) expect(c.id.startsWith(ID_PREFIX[c.tab]), c.id).toBe(true);
  });

  it("explains every control in one plain sentence", () => {
    for (const c of CONTROLS) {
      expect(c.label.trim(), c.id).not.toBe("");
      expect(c.what.trim().length, c.id).toBeGreaterThan(10);
      expect(c.what.length, `${c.id} hint too long for a tooltip`).toBeLessThanOrEqual(220);
    }
  });

  it("links only to help topics that exist", () => {
    for (const c of CONTROLS.filter((x) => x.helpTopic)) {
      const route = TAB_ROUTES[c.tab];
      const topics = flattenTopics(route ? getHelpModule(route)?.topics ?? [] : []).map((t) => t.id);
      expect(topics, `${c.id} → ${c.helpTopic}`).toContain(c.helpTopic);
    }
  });

  it("covers every control marked in the UI, and every entry is used", () => {
    const used = usedIds();
    const registered = new Set(CONTROLS.map((c) => c.id));
    const missing = [...used].filter(([id]) => !registered.has(id)).map(([id, file]) => `${id} (${file})`);
    const unused = [...registered].filter((id) => !used.has(id));
    expect(missing, "used in the UI but not in help/controls.ts").toEqual([]);
    expect(unused, "in help/controls.ts but not used in the UI").toEqual([]);
  });
});
