import { CONTROLS, TAB_ROUTES, type ControlHint, type ControlTab } from "./controls";
import { getHelpModule } from "./registry";
import { flattenTopics } from "./topicUtils";

export type FinderResult =
  | { kind: "control"; control: ControlHint; score: number }
  | { kind: "topic"; tab: ControlTab; route: string; id: string; title: string; score: number };

export function normalise(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function words(text: string): string[] {
  return normalise(text).split(/[^a-z0-9₀-₉%]+/).filter(Boolean);
}

// Every query word must start a word in the text; returns how well the field matched or 0.
function fieldScore(queryWords: string[], fieldWords: string[], weight: number): number {
  if (queryWords.length === 0) return 0;
  return queryWords.every((q) => fieldWords.some((w) => w.startsWith(q))) ? weight : 0;
}

export function scoreControl(control: ControlHint, query: string, currentTab: ControlTab | null): number {
  const q = words(query);
  if (q.length === 0) return 0;
  const label = words(control.label);
  const exactLabel = normalise(control.label).startsWith(normalise(query.trim())) ? 100 : 0;
  const base = Math.max(
    exactLabel,
    fieldScore(q, label, 80),
    fieldScore(q, words((control.keywords ?? []).join(" ")), 60),
    fieldScore(q, [...label, ...words(control.what), ...words((control.keywords ?? []).join(" "))], 40),
  );
  if (base === 0) return 0;
  const tabBonus = control.tab === currentTab ? 30 : control.tab === "app" ? 15 : 0;
  return base + tabBonus;
}

export function searchFinder(query: string, currentTab: ControlTab | null, limit = 12): FinderResult[] {
  const controls: FinderResult[] = CONTROLS.map((control) => ({
    kind: "control" as const,
    control,
    score: scoreControl(control, query, currentTab),
  })).filter((r) => r.score > 0);

  const q = words(query);
  const topics: FinderResult[] = [];
  if (q.length) {
    for (const tab of Object.keys(TAB_ROUTES) as ControlTab[]) {
      const route = TAB_ROUTES[tab];
      if (!route) continue;
      for (const t of flattenTopics(getHelpModule(route)?.topics ?? [])) {
        const s = fieldScore(q, words(`${t.title} ${t.haystack}`), 20);
        if (s) topics.push({ kind: "topic", tab, route, id: t.id, title: t.title, score: s + (tab === currentTab ? 10 : 0) });
      }
    }
  }
  const byScore = (a: FinderResult, b: FinderResult) => b.score - a.score;
  return [...controls.sort(byScore), ...topics.sort(byScore)].slice(0, limit);
}
