import type { AIProviderClient, ProviderChatRequest, ProviderToolCall } from "./types";

function lastUserMessage(messages: ProviderChatRequest["messages"]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") return messages[i].content;
  }
  return "";
}

function firstSessionId(request: ProviderChatRequest): string | null {
  return request.settings.sessionIds?.find(Boolean) ?? null;
}

function matchMz(text: string): number | null {
  const match = text.match(/m\/?z\s*[:=]?\s*(\d+(?:\.\d+)?)/i) ?? text.match(/\b(\d{2,5}(?:\.\d+)?)\b/);
  return match ? Number(match[1]) : null;
}

function call(name: string, args: Record<string, unknown>): ProviderToolCall {
  return {
    id: `demo-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    name,
    arguments: args,
  };
}

export const demoProvider: AIProviderClient = {
  id: "demo",
  async chat(request) {
    const text = lastUserMessage(request.messages).toLowerCase();
    const sessionId = firstSessionId(request);
    const mz = matchMz(text);
    const toolCalls: ProviderToolCall[] = [];

    if (text.includes("clear") && text.includes("eic")) {
      toolCalls.push(call("lcms.clear_eics", {}));
    } else if (text.includes("integrat") && text.includes("eic")) {
      toolCalls.push(call("lcms.integrate_visible_eics", {}));
    } else if ((text.includes("create") || text.includes("make") || text.includes("generate")) && text.includes("eic") && mz) {
      if (sessionId) toolCalls.push(call("lcms.create_eic_and_show", { session_id: sessionId, mz, source: "automation" }));
      else toolCalls.push(call("lcms.list_sessions", {}));
    } else if (text.includes("find") && mz) {
      if (sessionId) toolCalls.push(call("lcms.find_mz", { session_id: sessionId, mz }));
      else toolCalls.push(call("lcms.list_sessions", {}));
    } else if (text.includes("kendrick")) {
      toolCalls.push(call("lcms.open_dialog", { dialog: "kendrick" }));
    }

    if (toolCalls.length) {
      return {
        message: "I found a matching LCMS action and will run it through the automation layer.",
        tool_calls: toolCalls,
        is_mock: true,
      };
    }

    return {
      message:
        "Demo mode can run simple local commands like creating an EIC, integrating visible EICs, clearing EICs, finding an m/z, or opening the Kendrick dialog. For broader reasoning, switch to OpenAI, Anthropic, or Ollama.",
      tool_calls: [],
      is_mock: true,
    };
  },
  async test() {
    return { ok: true, message: "Demo provider is ready." };
  },
};
