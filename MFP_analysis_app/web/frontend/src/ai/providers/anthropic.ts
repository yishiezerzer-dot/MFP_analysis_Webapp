import {
  actionIdFromProviderToolName,
  parseToolArguments,
  providerToolName,
  type AIProviderClient,
  type ProviderChatRequest,
  type ProviderMessage,
} from "./types";

function splitAnthropicMessages(messages: ProviderMessage[]) {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const body = messages
    .filter((message) => message.role !== "system")
    .map((message) => {
      if (message.role === "tool") {
        return {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: message.tool_call_id,
              content: message.content,
            },
          ],
        };
      }
      if (message.role === "assistant" && message.tool_calls?.length) {
        return {
          role: "assistant",
          content: [
            ...(message.content ? [{ type: "text", text: message.content }] : []),
            ...message.tool_calls.map((toolCall) => ({
              type: "tool_use",
              id: toolCall.id,
              name: providerToolName(toolCall.name),
              input: toolCall.arguments ?? {},
            })),
          ],
        };
      }
      return { role: message.role === "assistant" ? "assistant" : "user", content: message.content };
    });
  return { system, messages: body };
}

export const anthropicProvider: AIProviderClient = {
  id: "anthropic",
  async chat(request: ProviderChatRequest) {
    if (!request.settings.apiKey) throw new Error("Anthropic API key is missing.");
    const prepared = splitAnthropicMessages(request.messages);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": request.settings.apiKey,
        "anthropic-version": "2023-06-01",
        // Required for browser-origin requests; without it Anthropic's CORS
        // policy rejects the preflight and the request never reaches the API.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: request.settings.model || "claude-sonnet-4-20250514",
        max_tokens: 2048,
        system: prepared.system || undefined,
        messages: prepared.messages,
        tools: request.tools.map((tool) => ({
          name: providerToolName(tool.name),
          description: tool.description,
          input_schema: tool.inputSchema,
        })),
      }),
    });
    if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${await res.text()}`);
    const payload = await res.json();
    const content = Array.isArray(payload?.content) ? payload.content : [];
    return {
      message: content
        .filter((item: Record<string, unknown>) => item.type === "text")
        .map((item: Record<string, unknown>) => String(item.text ?? ""))
        .join("\n"),
      tool_calls: content
        .filter((item: Record<string, unknown>) => item.type === "tool_use")
        .map((item: Record<string, unknown>) => ({
          id: String(item.id ?? crypto.randomUUID()),
          name: actionIdFromProviderToolName(String(item.name ?? ""), request.tools),
          arguments: parseToolArguments(item.input),
        })),
      raw: payload,
    };
  },
  async test(settings) {
    if (!settings.apiKey) return { ok: false, message: "Anthropic API key is missing." };
    try {
      const response = await anthropicProvider.chat({
        settings,
        tools: [],
        messages: [{ role: "user", content: "Reply with exactly: ok" }],
      });
      return { ok: true, message: response.message || "Anthropic responded." };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  },
};
