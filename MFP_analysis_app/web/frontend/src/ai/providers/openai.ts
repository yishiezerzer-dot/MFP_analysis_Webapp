import {
  actionIdFromProviderToolName,
  parseToolArguments,
  providerToolName,
  textFromUnknown,
  type AIProviderClient,
  type ProviderChatRequest,
  type ProviderMessage,
} from "./types";

function toOpenAIMessages(messages: ProviderMessage[]) {
  return messages.map((message) => {
    if (message.role === "tool") {
      return { role: "tool", tool_call_id: message.tool_call_id, content: message.content };
    }
    if (message.role === "assistant" && message.tool_calls?.length) {
      return {
        role: "assistant",
        content: message.content || null,
        tool_calls: message.tool_calls.map((toolCall) => ({
          id: toolCall.id,
          type: "function",
          function: {
            name: providerToolName(toolCall.name),
            arguments: JSON.stringify(toolCall.arguments ?? {}),
          },
        })),
      };
    }
    return { role: message.role, content: message.content };
  });
}

export const openAIProvider: AIProviderClient = {
  id: "openai",
  async chat(request: ProviderChatRequest) {
    if (!request.settings.apiKey) throw new Error("OpenAI API key is missing.");
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${request.settings.apiKey}`,
      },
      body: JSON.stringify({
        model: request.settings.model || "gpt-4.1-mini",
        messages: toOpenAIMessages(request.messages),
        tools: request.tools.map((tool) => ({
          type: "function",
          function: {
            name: providerToolName(tool.name),
            description: tool.description,
            parameters: tool.inputSchema,
          },
        })),
        tool_choice: "auto",
      }),
    });
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${await res.text()}`);
    const payload = await res.json();
    const choice = payload?.choices?.[0]?.message ?? {};
    return {
      message: textFromUnknown(choice.content),
      tool_calls: (choice.tool_calls ?? []).map((item: Record<string, unknown>) => {
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
    if (!settings.apiKey) return { ok: false, message: "OpenAI API key is missing." };
    try {
      const response = await openAIProvider.chat({
        settings,
        tools: [],
        messages: [{ role: "user", content: "Reply with exactly: ok" }],
      });
      return { ok: true, message: response.message || "OpenAI responded." };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  },
};
