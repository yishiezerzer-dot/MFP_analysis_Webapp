import {
  actionIdFromProviderToolName,
  parseToolArguments,
  providerToolName,
  type AIProviderClient,
  type ProviderChatRequest,
  type ProviderMessage,
} from "./types";

function toOllamaMessages(messages: ProviderMessage[]) {
  return messages.map((message) => {
    if (message.role === "tool") return { role: "tool", content: message.content, tool_call_id: message.tool_call_id };
    if (message.role === "assistant" && message.tool_calls?.length) {
      return {
        role: "assistant",
        content: message.content,
        tool_calls: message.tool_calls.map((toolCall) => ({
          function: {
            name: providerToolName(toolCall.name),
            arguments: toolCall.arguments ?? {},
          },
        })),
      };
    }
    return { role: message.role, content: message.content };
  });
}

export const ollamaProvider: AIProviderClient = {
  id: "ollama",
  async chat(request: ProviderChatRequest) {
    const baseUrl = (request.settings.baseUrl || "http://127.0.0.1:11434").replace(/\/$/, "");
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.settings.model || "llama3.1:8b",
        messages: toOllamaMessages(request.messages),
        stream: false,
        tools: request.tools.map((tool) => ({
          type: "function",
          function: {
            name: providerToolName(tool.name),
            description: tool.description,
            parameters: tool.inputSchema,
          },
        })),
      }),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
    const payload = await res.json();
    const message = payload?.message ?? {};
    return {
      message: String(message.content ?? ""),
      tool_calls: (message.tool_calls ?? []).map((item: Record<string, unknown>) => {
        const fn = (item.function ?? {}) as Record<string, unknown>;
        return {
          id: String(item.id ?? crypto.randomUUID()),
          name: actionIdFromProviderToolName(String(fn.name ?? ""), request.tools),
          arguments: parseToolArguments(fn.arguments),
        };
      }),
      raw: payload,
    };
  },
  async test(settings) {
    try {
      const response = await ollamaProvider.chat({
        settings,
        tools: [],
        messages: [{ role: "user", content: "Reply with exactly: ok" }],
      });
      return { ok: true, message: response.message || "Ollama responded." };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  },
};
