import { anthropicProvider } from "./anthropic";
import { demoProvider } from "./demo";
import { ollamaProvider } from "./ollama";
import { openAIProvider } from "./openai";
import type { AIProviderClient, AIProviderId } from "./types";

export type {
  AIProviderClient,
  AIProviderId,
  ProviderChatRequest,
  ProviderChatResponse,
  ProviderMessage,
  ProviderSettings,
  ProviderTool,
  ProviderToolCall,
} from "./types";

export const aiProviders: Record<AIProviderId, AIProviderClient> = {
  demo: demoProvider,
  openai: openAIProvider,
  anthropic: anthropicProvider,
  ollama: ollamaProvider,
};
