import type { HelpTopic } from "./types";

export interface FlatTopic {
  id: string;
  title: string;
  depth: number;
  pathTitles: string[];
  haystack: string;
}

function collectHaystack(topic: HelpTopic): string {
  const parts = [
    topic.title,
    ...(topic.keywords ?? []),
    topic.searchText ?? "",
  ];
  return parts.join(" ").toLowerCase();
}

export function flattenTopics(topics: HelpTopic[], depth = 0, pathTitles: string[] = []): FlatTopic[] {
  const out: FlatTopic[] = [];
  for (const t of topics) {
    const nextPath = [...pathTitles, t.title];
    out.push({
      id: t.id,
      title: t.title,
      depth,
      pathTitles: nextPath,
      haystack: collectHaystack(t),
    });
    if (t.children?.length) {
      out.push(...flattenTopics(t.children, depth + 1, nextPath));
    }
  }
  return out;
}

function topicMatches(topic: HelpTopic, q: string): boolean {
  if (!q) return true;
  return collectHaystack(topic).includes(q);
}

export function filterTopicTree(topics: HelpTopic[], query: string): HelpTopic[] {
  const q = query.trim().toLowerCase();
  if (!q) return topics;
  const walk = (list: HelpTopic[]): HelpTopic[] => {
    const res: HelpTopic[] = [];
    for (const t of list) {
      if (topicMatches(t, q)) {
        res.push({ ...t, children: t.children });
        continue;
      }
      const childFiltered = t.children ? walk(t.children) : undefined;
      if (childFiltered && childFiltered.length > 0) {
        res.push({ ...t, children: childFiltered });
      }
    }
    return res;
  };
  return walk(topics);
}
