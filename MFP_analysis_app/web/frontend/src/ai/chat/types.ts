/** Types and small pure helpers shared across the chat UI. */
import type { AIAssistantMessage, AIContextSnapshot, AIModuleName, AIProvider, AIProviderStatus } from "../../api";
import type { ProviderMessage } from "../providers";

export interface ToolEvent {
  id: string;
  actionId: string;
  args: Record<string, unknown>;
  risk: "safe" | "confirm" | "destructive";
  scope: "backend" | "browser" | "both";
  status: "ran" | "pending" | "rejected" | "error";
  result?: unknown;
  error?: string;
  preview?: unknown;
  confirmationToken?: string;
}

export interface ChatTurn extends AIAssistantMessage {
  id: string;
  mode_hint?: string;
  is_mock?: boolean;
  error?: string | null;
  toolEvents?: ToolEvent[];
  trace?: unknown[];
  used_context?: {
    active_module: string;
    loaded_filenames: string[];
    module_summary: string;
  } | null;
}

export const MODULE_NAMES: AIModuleName[] = ["LCMS", "FTIR", "Plate Reader", "Data Studio"];

export function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

export function defaultModelFor(provider: AIProvider, status: AIProviderStatus | null): string {
  if (provider === "openai") return status?.openai.default_model || "gpt-4.1-mini";
  if (provider === "anthropic") return status?.anthropic?.default_model || "claude-sonnet-4-20250514";
  if (provider === "ollama") return status?.ollama.default_model || "llama3.1:8b";
  return "demo";
}

export function buildToolSystemPrompt({
  activeModule,
  includeContext,
  context,
  sessionIds,
}: {
  activeModule: AIModuleName | "";
  includeContext: boolean;
  context: AIContextSnapshot | null;
  sessionIds: string[];
}): string {
  const moduleSummary = activeModule && context?.[activeModule]?.summary ? context[activeModule].summary : "";
  const loaded = context?.LCMS?.sessions ?? [];
  return [
    "You are the in-app analysis assistant for this local lab webapp.",
    "Use automation tools when the user asks you to inspect LCMS data, create EICs, integrate peaks, open dialogs, export CSV, or modify visible app state.",
    "Prefer LCMS action ids exactly as exposed. If an action needs a session_id, use one of the selected or loaded LCMS session ids.",
    "For destructive or confirmation actions, request the tool call normally; the app will show the approval step.",
    includeContext ? `Active module: ${activeModule || "auto"}. ${moduleSummary}` : "Prompt context is disabled.",
    `Selected/available LCMS session ids: ${sessionIds.length ? sessionIds.join(", ") : "none"}.`,
    loaded.length ? `Loaded LCMS files: ${loaded.map((item) => `${item.display_name} (${item.session_id})`).join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Rebuild the provider message stream from chat turns + system prompt. */
export function turnsToProviderMessages(
  turns: ChatTurn[],
  systemPrompt: string,
): ProviderMessage[] {
  const messages: ProviderMessage[] = [{ role: "system", content: systemPrompt }];
  for (const turn of turns) {
    if (turn.role === "user") {
      messages.push({ role: "user", content: turn.content });
      continue;
    }
    if (turn.role !== "assistant") continue;
    const events = turn.toolEvents ?? [];
    const toolCalls = events.map((event) => ({
      id: event.id,
      name: event.actionId,
      arguments: event.args,
    }));
    messages.push({
      role: "assistant",
      content: turn.content,
      tool_calls: toolCalls.length ? toolCalls : undefined,
    });
    for (const event of events) {
      if (event.status === "pending") continue;
      let content: string;
      if (event.status === "ran") content = JSON.stringify(event.result ?? {});
      else if (event.status === "rejected") content = JSON.stringify({ rejected: true });
      else content = JSON.stringify({ error: event.error ?? "tool failed" });
      messages.push({ role: "tool", tool_call_id: event.id, content });
    }
  }
  return messages;
}

// ----- result-shape extractors used by ToolResultCard ----------------------

export function unwrapResult(value: unknown): unknown {
  if (value && typeof value === "object" && "result" in value) return (value as Record<string, unknown>).result;
  return value;
}

export function findEicPayload(value: unknown): Record<string, unknown> | null {
  const root = unwrapResult(value);
  if (!root || typeof root !== "object") return null;
  const obj = root as Record<string, unknown>;
  const eic = obj.eic && typeof obj.eic === "object" ? (obj.eic as Record<string, unknown>) : obj;
  return Array.isArray(eic.rt_min) && Array.isArray(eic.intensity) ? eic : null;
}

export function findKendrickPayload(value: unknown): Record<string, unknown> | null {
  const root = unwrapResult(value);
  if (!root || typeof root !== "object") return null;
  const obj = root as Record<string, unknown>;
  return Array.isArray(obj.points) ? obj : null;
}

export function findFeatureRows(value: unknown): Record<string, unknown>[] {
  const root = unwrapResult(value);
  if (!root || typeof root !== "object") return [];
  const obj = root as Record<string, unknown>;
  const candidates = [obj.rows, obj.feature_rows, obj.features, obj.row ? [obj.row] : null];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter((row): row is Record<string, unknown> => !!row && typeof row === "object");
    }
  }
  return [];
}

export function findCsvPayload(value: unknown): string | null {
  const root = unwrapResult(value);
  if (!root || typeof root !== "object") return null;
  const obj = root as Record<string, unknown>;
  const csv = obj.csv ?? obj.csv_text ?? obj.content;
  return typeof csv === "string" && csv.includes(",") ? csv : null;
}

export function numberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number).filter((item) => Number.isFinite(item)) : [];
}

export function statusClass(status: ToolEvent["status"]): string {
  if (status === "ran") return "bg-emerald-50 text-emerald-700";
  if (status === "pending") return "bg-amber-50 text-amber-700";
  if (status === "error") return "bg-red-50 text-red-700";
  return "bg-ink-100 text-ink-600";
}

export function formatCell(value: unknown): string {
  if (typeof value === "number") return Number.isFinite(value) ? value.toPrecision(5) : "";
  if (typeof value === "string") return truncate(value, 28);
  if (value == null) return "";
  return truncate(JSON.stringify(value), 28);
}

export function stringProp(value: unknown, key: string): string | null {
  return value && typeof value === "object" && typeof (value as Record<string, unknown>)[key] === "string"
    ? String((value as Record<string, unknown>)[key])
    : null;
}

export function hasStringProp(value: unknown, key: string): value is Record<string, string> {
  return !!value && typeof value === "object" && typeof (value as Record<string, unknown>)[key] === "string";
}
