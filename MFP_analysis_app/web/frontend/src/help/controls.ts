// One entry per control: the hover hint, the Ctrl+K finder, tours and "Show me" all read this list.
// A test fails when a control in the UI has no entry here, or an entry is not used in the UI.

export type ControlTab = "lcms" | "ftir" | "plate-reader" | "ai" | "app";

export interface ControlHint {
  id: string;
  tab: ControlTab;
  label: string;
  what: string;
  typical?: string;
  keywords?: string[];
  // A panel/section that must be opened before the control is visible (see useRevealPanel).
  panel?: string;
  helpTopic?: string;
}

export const TAB_ROUTES: Record<ControlTab, string | null> = {
  lcms: "/lcms",
  ftir: "/ftir",
  "plate-reader": "/plate-reader",
  ai: "/ai",
  app: null,
};

export const TAB_LABELS: Record<ControlTab, string> = {
  lcms: "LCMS",
  ftir: "FTIR",
  "plate-reader": "Plate Reader",
  ai: "AI Assistant",
  app: "Everywhere",
};

export const CONTROLS: ControlHint[] = [
  {
    id: "app.help",
    tab: "app",
    label: "Help",
    what: "Opens the guide for this tab: what each part does, how results are calculated, and troubleshooting.",
    keywords: ["manual", "guide", "documentation", "f1"],
  },
  {
    id: "app.findControl",
    tab: "app",
    label: "Find a control",
    what: "Search every button and setting by name or purpose; Enter jumps to it and highlights it.",
    typical: "Ctrl+K (⌘K on a Mac)",
    keywords: ["search", "command", "where", "locate"],
  },
];

const BY_ID = new Map(CONTROLS.map((c) => [c.id, c]));

export function getControl(id: string): ControlHint | undefined {
  return BY_ID.get(id);
}

export function tabOfRoute(pathname: string): ControlTab | null {
  const base = pathname.replace(/\/$/, "");
  const hit = (Object.keys(TAB_ROUTES) as ControlTab[]).find((t) => TAB_ROUTES[t] === base);
  return hit ?? null;
}
