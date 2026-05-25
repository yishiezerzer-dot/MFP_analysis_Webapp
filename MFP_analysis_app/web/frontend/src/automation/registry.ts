import { useCallback } from "react";
import { z } from "zod";
import { useBrowserAutomation, type AutomationArgs } from "./BrowserBridge";
import { automationActionSchemas, type AutomationActionId } from "./schemas";

export type ActionScope = "backend" | "browser" | "both";
export type ActionRisk = "safe" | "confirm" | "destructive";

export interface AutomationActionSpec {
  id: string;
  summary: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  risk: ActionRisk;
  scope: ActionScope;
}

export interface AutomationPreview {
  action_id?: string;
  confirmation_token?: string;
  token?: string;
  affected_session_ids?: string[];
  estimated_duration_ms?: number | null;
  warnings?: string[];
  preview?: unknown;
  [key: string]: unknown;
}

let catalogPromise: Promise<Map<string, AutomationActionSpec>> | null = null;

async function handleJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail: unknown = res.statusText;
    try {
      const payload = await res.json();
      detail = payload?.detail ?? payload?.message ?? payload;
    } catch {
      // keep status text
    }
    throw new Error(`HTTP ${res.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
  return res.json() as Promise<T>;
}

async function actionCatalog() {
  if (!catalogPromise) {
    catalogPromise = fetch("/api/automation/actions")
      .then((res) => handleJson<AutomationActionSpec[]>(res))
      .then((items) => new Map(items.map((item) => [item.id, item])));
  }
  return catalogPromise;
}

export async function getAutomationActionCatalog(): Promise<AutomationActionSpec[]> {
  const catalog = await actionCatalog();
  return Array.from(catalog.values());
}

/** Drop the cached catalog so the next dispatch re-fetches it. Useful for the
 * in-app assistant (phase 6) when new actions get registered at runtime, and
 * for tests that mock the catalog. */
export function refreshAutomationCatalog(): void {
  catalogPromise = null;
}

function parseActionArgs(actionId: string, args: unknown): AutomationArgs {
  const schema = automationActionSchemas[actionId as AutomationActionId] as z.ZodTypeAny | undefined;
  if (!schema) return (args ?? {}) as AutomationArgs;
  return schema.parse(args ?? {}) as AutomationArgs;
}

async function executeBackendAction(actionId: string, args: AutomationArgs) {
  return fetch(`/api/automation/actions/${encodeURIComponent(actionId)}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  }).then((res) => handleJson<Record<string, unknown>>(res));
}

export async function executeAutomationActionRaw(actionId: string, args: AutomationArgs = {}) {
  return executeBackendAction(actionId, args);
}

export async function previewAutomationAction(actionId: string, args: AutomationArgs = {}) {
  return fetch(`/api/automation/actions/${encodeURIComponent(actionId)}/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  }).then((res) => handleJson<AutomationPreview>(res));
}

export function useAutomationDispatch() {
  const browserAutomation = useBrowserAutomation();

  return useCallback(
    async (actionId: AutomationActionId, args: unknown = {}) => {
      const parsed = parseActionArgs(actionId, args);
      const catalog = await actionCatalog();
      const spec = catalog.get(actionId);
      if (spec?.scope === "browser") {
        return browserAutomation.dispatchLocal(actionId, parsed);
      }
      return executeBackendAction(actionId, parsed);
    },
    [browserAutomation],
  );
}

export function resetAutomationCatalogForTests() {
  // Alias kept for clarity in tests; same effect as refreshAutomationCatalog.
  catalogPromise = null;
}
