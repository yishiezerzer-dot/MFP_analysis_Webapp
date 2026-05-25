export type AIProviderId = "demo" | "openai" | "anthropic" | "ollama";

export type ProviderRole = "system" | "user" | "assistant" | "tool";

export interface ProviderToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ProviderMessage {
  role: ProviderRole;
  content: string;
  tool_call_id?: string;
  tool_calls?: ProviderToolCall[];
}

export interface ProviderTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  risk?: string;
  scope?: string;
}

export interface ProviderSettings {
  provider: AIProviderId;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  sessionIds?: string[];
}

export interface ProviderChatRequest {
  messages: ProviderMessage[];
  tools: ProviderTool[];
  settings: ProviderSettings;
}

export interface ProviderChatResponse {
  message: string;
  tool_calls: ProviderToolCall[];
  is_mock?: boolean;
  raw?: unknown;
}

export interface ProviderTestResponse {
  ok: boolean;
  message: string;
}

export interface AIProviderClient {
  id: AIProviderId;
  chat: (request: ProviderChatRequest) => Promise<ProviderChatResponse>;
  test: (settings: ProviderSettings) => Promise<ProviderTestResponse>;
}

/** Convert an action id (e.g. `lcms.create_eic`) into a tool name compatible
 * with OpenAI/Anthropic/Ollama function-call schemas (no dots).
 *
 * NOTE: action ids containing a literal double-underscore would round-trip
 * incorrectly (the reverse map would treat `__` as a `.` separator). The
 * action-id regex on the backend already forbids underscores at the boundary
 * but not pairs in the middle; we assert here as a belt-and-braces check. */
export function providerToolName(actionId: string): string {
  if (actionId.includes("__")) {
    throw new Error(
      `Action id ${JSON.stringify(actionId)} contains '__' which is reserved as the dot-replacement marker for provider tool names. Rename the action.`,
    );
  }
  return actionId.replace(/[^A-Za-z0-9_-]/g, "__");
}

export function actionIdFromProviderToolName(name: string, tools: ProviderTool[]): string {
  // Prefer an exact match against a known tool, then a sanitized-name match,
  // then fall back to the naive reverse-substitution. This means a tool that
  // legitimately contains `__` will always resolve via the catalog lookup and
  // never go through the lossy reverse mapping.
  const direct = tools.find((tool) => tool.name === name);
  if (direct) return direct.name;
  return tools.find((tool) => providerToolName(tool.name) === name)?.name ?? name.replace(/__/g, ".");
}

export function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

export function textFromUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) return String((item as { text?: unknown }).text ?? "");
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}
