import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import Plot from "react-plotly.js";
import type { Data, Layout } from "plotly.js";
import { useLocation } from "react-router-dom";
import {
  api,
  AIAssistantMessage,
  AIContextSession,
  AIContextSnapshot,
  AIModuleName,
  AIProvider,
  AIProviderStatus,
} from "../api";
import {
  aiProviders,
  type ProviderMessage,
  type ProviderTool,
  type ProviderToolCall,
} from "../ai/providers";
import {
  executeAutomationActionRaw,
  getAutomationActionCatalog,
  previewAutomationAction,
  useAutomationDispatch,
  type AutomationActionSpec,
} from "../automation/registry";
import type { AutomationActionId } from "../automation/schemas";
import { AlertBanner } from "../components/AlertBanner";
import { Tooltip } from "../components/Tooltip";
import { PageHeaderContent, usePageHeader } from "../layout/PageHeader";
import { HelpOpenButton, HelpShell } from "../help/HelpShell";
import { getHelpModule } from "../help/registry";
import { usePlotlyTheme } from "../theme/ThemeProvider";

const MODULE_NAMES: AIModuleName[] = ["LCMS", "FTIR", "Plate Reader", "Data Studio"];

interface ChatTurn extends AIAssistantMessage {
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

interface ToolEvent {
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

function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function useStoredRecord(
  key: string,
  fallback: Record<string, string>,
): [Record<string, string>, React.Dispatch<React.SetStateAction<Record<string, string>>>] {
  const [value, setValue] = useState<Record<string, string>>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? { ...fallback, ...(JSON.parse(raw) as Record<string, string>) } : fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore storage failures; the UI still works for this session.
    }
  }, [key, value]);
  return [value, setValue];
}

function useStoredBoolean(
  key: string,
  fallback: boolean,
): [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? fallback : raw === "true";
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(key, String(value));
    } catch {
      // Ignore storage failures; the UI still works for this session.
    }
  }, [key, value]);
  return [value, setValue];
}

function defaultModelFor(provider: AIProvider, status: AIProviderStatus | null): string {
  if (provider === "openai") return status?.openai.default_model || "gpt-4.1-mini";
  if (provider === "anthropic") return status?.anthropic?.default_model || "claude-sonnet-4-20250514";
  if (provider === "ollama") return status?.ollama.default_model || "llama3.1:8b";
  return "demo";
}

/** Rebuild the provider message stream from chat turns + system prompt.
 *
 * Walks each turn in order, surfacing tool_calls on the assistant message
 * and a follow-up `{role: "tool", tool_call_id, content}` for every
 * completed tool event. Pending events are intentionally skipped — the
 * provider hasn't seen their results yet. */
function turnsToProviderMessages(
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

function buildToolSystemPrompt({
  activeModule,
  includeContext,
  context,
  sessionIds,
}: {
  activeModule: AIModuleName | "";
  includeContext: boolean;
  context: AIContextSnapshot | null;
  sessionIds: string[];
}) {
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

export function AIView() {
  const [status, setStatus] = useState<AIProviderStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [provider, setProvider] = useState<AIProvider>("demo");
  const [model, setModel] = useState<string>("");
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState<string>("");
  const [apiKeys, setApiKeys] = useStoredRecord("mfp.ai.providerKeys", {});
  const [showToolTrace, setShowToolTrace] = useStoredBoolean("mfp.ai.showToolTrace", false);
  // Default OFF for live providers: silently mutating session state on the
  // very first AI response is surprising and potentially destructive. Demo
  // provider auto-executes since it's local and key-free.
  const [autoExecuteSafeActions, setAutoExecuteSafeActions] = useStoredBoolean(
    "mfp.ai.autoExecuteSafeActions",
    false,
  );
  const [providerTest, setProviderTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [automationActions, setAutomationActions] = useState<AutomationActionSpec[]>([]);
  const [automationError, setAutomationError] = useState<string | null>(null);

  const [context, setContext] = useState<AIContextSnapshot | null>(null);
  const [activeModule, setActiveModule] = useState<AIModuleName | "">("");
  const [selectedSids, setSelectedSids] = useState<Set<string>>(new Set());
  const [includeContext, setIncludeContext] = useState(true);

  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transcriptRef = useRef<HTMLDivElement>(null);
  const dispatchAutomation = useAutomationDispatch();
  const plotlyTheme = usePlotlyTheme();
  const abortRef = useRef<AbortController | null>(null);

  const location = useLocation();
  const [helpOpen, setHelpOpen] = useState(false);
  const helpModule = useMemo(() => getHelpModule(location.pathname), [location.pathname]);

  useEffect(() => {
    api.ai
      .status()
      .then((s) => {
        setStatus(s);
        setProvider(s.default);
        setModel(
          s.default === "openai"
            ? s.openai.default_model
            : s.default === "anthropic"
              ? s.anthropic?.default_model || "claude-sonnet-4-20250514"
            : s.default === "ollama"
              ? s.ollama.default_model
              : "",
        );
        setOllamaBaseUrl(s.ollama.base_url || "http://127.0.0.1:11434");
      })
      .catch((e) => setStatusError(String(e)));
  }, []);

  useEffect(() => {
    getAutomationActionCatalog()
      .then((items) => {
        setAutomationActions(items);
        setAutomationError(null);
      })
      .catch((err) => setAutomationError(String(err)));
  }, []);

  const refreshContext = useCallback(() => {
    api.ai
      .context()
      .then((c) => {
        setContext(c);
        setActiveModule((prev) => {
          if (prev) return prev;
          for (const m of MODULE_NAMES) {
            if (c[m]?.sessions?.length) return m;
          }
          return "";
        });
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshContext();
  }, [refreshContext]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [turns, busy]);

  const handleProviderChange = (next: AIProvider) => {
    setProvider(next);
    if (!status) return;
    if (next === "openai") setModel(status.openai.default_model);
    else if (next === "anthropic") setModel(status.anthropic?.default_model || "claude-sonnet-4-20250514");
    else if (next === "ollama") setModel(status.ollama.default_model);
    else setModel("demo");
    setProviderTest(null);
  };

  const toggleSession = (sid: string) => {
    setSelectedSids((prev) => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return next;
    });
  };

  const clearSelection = () => setSelectedSids(new Set());

  const selectedOrContextSessionIds = useMemo(() => {
    const selected = Array.from(selectedSids);
    if (selected.length) return selected;
    const lcmsSessions = context?.LCMS?.sessions ?? [];
    return lcmsSessions.map((session) => session.session_id);
  }, [context, selectedSids]);

  const providerTools: ProviderTool[] = useMemo(
    () =>
      automationActions.map((action) => ({
        name: action.id,
        description: `${action.summary} Risk: ${action.risk}. Scope: ${action.scope}.`,
        inputSchema: action.input_schema,
        risk: action.risk,
        scope: action.scope,
      })),
    [automationActions],
  );

  const executeToolCall = useCallback(
    async (toolCall: ProviderToolCall): Promise<ToolEvent> => {
      const action = automationActions.find((item) => item.id === toolCall.name);
      const risk = action?.risk ?? "safe";
      const scope = action?.scope ?? "backend";
      const args = toolCall.arguments ?? {};

      if (risk === "safe") {
        if (!autoExecuteSafeActions) {
          return {
            id: toolCall.id,
            actionId: toolCall.name,
            args,
            risk,
            scope,
            status: "pending",
          };
        }
        try {
          // No fallback to executeAutomationActionRaw for missing browser
          // handlers — for scope=browser actions, the backend route returns
          // 409 (requires_open_app) anyway, so the fallback can't succeed.
          // Let the original error surface so the user gets a clear message.
          const result = await dispatchAutomation(toolCall.name as AutomationActionId, args);
          return { id: toolCall.id, actionId: toolCall.name, args, risk, scope, status: "ran", result };
        } catch (err) {
          return {
            id: toolCall.id,
            actionId: toolCall.name,
            args,
            risk,
            scope,
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }

      try {
        const preview = await previewAutomationAction(toolCall.name, args);
        return {
          id: toolCall.id,
          actionId: toolCall.name,
          args,
          risk,
          scope,
          status: "pending",
          preview,
          confirmationToken: String(preview.confirmation_token ?? preview.token ?? ""),
        };
      } catch (err) {
        return {
          id: toolCall.id,
          actionId: toolCall.name,
          args,
          risk,
          scope,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    [automationActions, autoExecuteSafeActions, dispatchAutomation],
  );

  const runProviderTest = useCallback(async () => {
    setProviderTest(null);
    const key = apiKeys[provider] ?? "";
    const client = aiProviders[provider];
    const response = await client.test({
      provider,
      model: model || defaultModelFor(provider, status),
      apiKey: key,
      baseUrl: provider === "ollama" ? ollamaBaseUrl : undefined,
      sessionIds: selectedOrContextSessionIds,
    });
    setProviderTest(response);
  }, [apiKeys, model, ollamaBaseUrl, provider, selectedOrContextSessionIds, status]);

  /** Run the provider/tool-call loop until the model returns a turn with no
   * tool_calls, an event is pending approval, or 4 iterations elapse. Shared
   * by `send` (new user message) and `approveToolEvent` (resume after
   * approval) so they always see the same conversation rebuilt from turns. */
  const runChatLoop = useCallback(
    async (
      seedTurns: ChatTurn[],
      signal?: AbortSignal,
    ): Promise<{ turns: ChatTurn[] }> => {
      const systemPrompt = buildToolSystemPrompt({
        activeModule,
        includeContext,
        context,
        sessionIds: selectedOrContextSessionIds,
      });
      const client = aiProviders[provider];
      const baseSettings = {
        provider,
        model: model || defaultModelFor(provider, status),
        apiKey: apiKeys[provider] ?? "",
        baseUrl: provider === "ollama" ? ollamaBaseUrl || undefined : undefined,
        sessionIds: selectedOrContextSessionIds,
      };
      let currentTurns = seedTurns;
      const trace: unknown[] = [];

      for (let i = 0; i < 4; i += 1) {
        if (signal?.aborted) throw new DOMException("cancelled", "AbortError");
        const messages = turnsToProviderMessages(currentTurns, systemPrompt);
        const resp = await client.chat({
          messages,
          tools: providerTools,
          settings: baseSettings,
        });
        trace.push({ provider, response: resp });

        // No tool calls — record final assistant turn and stop.
        if (!resp.tool_calls.length) {
          const assistantTurn: ChatTurn = {
            id: genId("a"),
            role: "assistant",
            content: resp.message || "(empty response)",
            mode_hint: "Tool-calling assistant",
            is_mock: resp.is_mock,
            trace,
          };
          currentTurns = [...currentTurns, assistantTurn];
          setTurns(currentTurns);
          return { turns: currentTurns };
        }

        // Build the assistant turn with its requested tool calls, then run
        // each call. If any pending action shows up, stop and ask the user.
        const events: ToolEvent[] = [];
        for (const toolCall of resp.tool_calls) {
          if (signal?.aborted) throw new DOMException("cancelled", "AbortError");
          const event = await executeToolCall(toolCall);
          events.push(event);
        }
        const assistantTurn: ChatTurn = {
          id: genId("a"),
          role: "assistant",
          content:
            resp.message ||
            (events.some((e) => e.status === "pending")
              ? `The assistant proposed ${events.length} action${events.length === 1 ? "" : "s"} — review and approve below.`
              : "I ran the requested tools. Results are attached below."),
          mode_hint: events.some((e) => e.status === "pending") ? "Tool approval required" : "Tool-calling assistant",
          is_mock: resp.is_mock,
          toolEvents: events,
          trace,
        };
        currentTurns = [...currentTurns, assistantTurn];
        setTurns(currentTurns);

        // Any pending event halts the loop; the user approves or rejects,
        // and approveToolEvent will resume by calling runChatLoop again.
        if (events.some((e) => e.status === "pending")) {
          return { turns: currentTurns };
        }
        // Otherwise loop back into the provider with the new tool results.
      }
      return { turns: currentTurns };
    },
    [
      activeModule,
      apiKeys,
      context,
      executeToolCall,
      includeContext,
      model,
      ollamaBaseUrl,
      provider,
      providerTools,
      selectedOrContextSessionIds,
      status,
    ],
  );

  const approveToolEvent = useCallback(
    async (turnId: string, eventId: string) => {
      const targetTurn = turns.find((t) => t.id === turnId);
      const targetEvent = targetTurn?.toolEvents?.find((e) => e.id === eventId);
      if (!targetEvent) return;

      // Run the approved action.
      let updatedEvent: ToolEvent;
      try {
        const result = await executeAutomationActionRaw(targetEvent.actionId, {
          ...targetEvent.args,
          confirmation_token: targetEvent.confirmationToken,
        });
        updatedEvent = { ...targetEvent, status: "ran", result };
      } catch (err) {
        updatedEvent = {
          ...targetEvent,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        };
      }

      // Apply the event update and resume the conversation by re-invoking
      // the provider with the tool result included. This is the fix for the
      // "approval doesn't loop back" bug.
      const updatedTurns = turns.map((turn) =>
        turn.id === turnId
          ? {
              ...turn,
              toolEvents: turn.toolEvents?.map((event) => (event.id === eventId ? updatedEvent : event)),
            }
          : turn,
      );
      setTurns(updatedTurns);

      // Only resume if every event in the pending turn is now resolved.
      const stillPending = updatedTurns
        .find((t) => t.id === turnId)
        ?.toolEvents?.some((e) => e.status === "pending");
      if (stillPending) return;

      abortRef.current = new AbortController();
      setBusy(true);
      try {
        await runChatLoop(updatedTurns, abortRef.current.signal);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [runChatLoop, turns],
  );

  const rejectToolEvent = useCallback(
    async (turnId: string, eventId: string) => {
      const updatedTurns = turns.map((turn) =>
        turn.id === turnId
          ? {
              ...turn,
              toolEvents: turn.toolEvents?.map((event) =>
                event.id === eventId ? { ...event, status: "rejected" as const } : event,
              ),
            }
          : turn,
      );
      setTurns(updatedTurns);
      // Resume the provider so it can react to the rejection (e.g. propose
      // an alternative or ask the user what to do instead).
      const stillPending = updatedTurns
        .find((t) => t.id === turnId)
        ?.toolEvents?.some((e) => e.status === "pending");
      if (stillPending) return;
      abortRef.current = new AbortController();
      setBusy(true);
      try {
        await runChatLoop(updatedTurns, abortRef.current.signal);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [runChatLoop, turns],
  );

  const cancelInFlight = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(
    async (textOverride?: string) => {
      const trimmed = (textOverride ?? input).trim();
      if (!trimmed || busy) return;
      setError(null);

      const userTurn: ChatTurn = { id: genId("u"), role: "user", content: trimmed };
      const nextTurns = [...turns, userTurn];
      setTurns(nextTurns);
      setInput("");
      setBusy(true);
      abortRef.current = new AbortController();
      try {
        await runChatLoop(nextTurns, abortRef.current.signal);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // User pressed Cancel — keep the user turn, drop the busy state.
        } else {
          setError(String(err));
          setTurns((prev) => prev.slice(0, -1));
          setInput(trimmed);
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, input, runChatLoop, turns],
  );

  const resetChat = () => {
    setTurns([]);
    setError(null);
  };

  usePageHeader(
    <PageHeaderContent
      title="AI Assistant"
      subtitle="Ask about FTIR, LCMS, plate reader, data studio workflows, or let the assistant run approved automation actions."
      actions={
        <>
          <HelpOpenButton onClick={() => setHelpOpen(true)} />
          <ProviderBadge status={status} provider={provider} />
        </>
      }
    />,
  );

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {statusError && (
        <div className="shrink-0 border-b border-red-200 bg-red-50 px-6 py-2 text-xs text-red-700">
          Could not load provider status: {statusError}
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-4">
        <aside className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto pr-1">
          <ProviderCard
            status={status}
            provider={provider}
            onProviderChange={handleProviderChange}
            model={model}
            onModelChange={setModel}
            apiKey={apiKeys[provider] ?? ""}
            onApiKeyChange={(value) => setApiKeys((prev) => ({ ...prev, [provider]: value }))}
            ollamaBaseUrl={ollamaBaseUrl}
            onOllamaBaseUrlChange={setOllamaBaseUrl}
            onTest={() => { void runProviderTest(); }}
            providerTest={providerTest}
          />

          <ContextCard
            context={context}
            activeModule={activeModule}
            onActiveModuleChange={setActiveModule}
            selectedSids={selectedSids}
            onToggleSession={toggleSession}
            onClearSelection={clearSelection}
            includeContext={includeContext}
            onIncludeContextChange={setIncludeContext}
            onRefresh={refreshContext}
          />

          <AssistantSettingsCard
            showToolTrace={showToolTrace}
            onShowToolTraceChange={setShowToolTrace}
            autoExecuteSafeActions={autoExecuteSafeActions}
            onAutoExecuteSafeActionsChange={setAutoExecuteSafeActions}
            actionCount={automationActions.length}
            error={automationError}
          />
        </aside>

        <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-ink-200 bg-surface shadow-card">
          <div className="flex shrink-0 items-center justify-between border-b border-ink-200 px-4 py-2">
            <div className="text-xs text-ink-500">
              {turns.length === 0
                ? "No messages yet — ask a question below."
                : `${turns.filter((t) => t.role === "user").length} message${
                    turns.filter((t) => t.role === "user").length === 1 ? "" : "s"
                  }`}
            </div>
            <div className="flex items-center gap-2">
              {turns.length > 0 && (
                <Tooltip content="Export conversation as text file">
                  <button
                    type="button"
                    className="btn-ghost text-xs"
                    onClick={() => {
                      const text = turns
                        .map((t) => `${t.role === "user" ? "You" : "Assistant"}:\n${t.content}`)
                        .join("\n\n");
                      const blob = new Blob([text], { type: "text/plain" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `ai-chat-${new Date().toISOString().slice(0, 10)}.txt`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    <DownloadIcon className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
              )}
              <Tooltip content="Clear all messages">
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={resetChat}
                  disabled={turns.length === 0 || busy}
                >
                  Clear chat
                </button>
              </Tooltip>
            </div>
          </div>

          <div
            ref={transcriptRef}
            className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
          >
            {turns.length === 0 ? (
              <EmptyTranscript
                status={status}
                provider={provider}
                onPick={(q) => { void send(q); }}
              />
            ) : (
              turns.map((t) =>
                t.role === "user" ? (
                  <UserBubble key={t.id} text={t.content} />
                ) : (
                  <AssistantBubble
                    key={t.id}
                    turn={t}
                    showTrace={showToolTrace}
                    onApprove={approveToolEvent}
                    onReject={rejectToolEvent}
                    plotlyTheme={plotlyTheme}
                  />
                ),
              )
            )}
            {busy && <TypingIndicator />}
          </div>

          <div className="shrink-0 border-t border-ink-200 bg-surface px-4 py-3">
            {error && (
              <AlertBanner
                kind="error"
                message={error}
                onDismiss={() => setError(null)}
                className="mb-2"
              />
            )}
            <Composer
              value={input}
              onChange={setInput}
              onSend={send}
              onCancel={cancelInFlight}
              busy={busy}
              hint={composerHint(provider, status, apiKeys[provider] ?? "")}
            />
          </div>
        </section>
      </div>
      {helpModule ? (
        <HelpShell open={helpOpen} module={helpModule} onClose={() => setHelpOpen(false)} />
      ) : null}
    </div>
  );
}

function composerHint(provider: AIProvider, status: AIProviderStatus | null, apiKey?: string): string {
  if (!status) return "";
  if (provider === "openai") {
    return status.openai.available
      ? "OpenAI key detected — live model in use."
      : "OpenAI unavailable: set OPENAI_API_KEY or switch provider.";
  }
  if (provider === "anthropic") {
    return apiKey ? "Anthropic tool calling is ready." : "Anthropic needs an API key in the provider card.";
  }
  if (provider === "ollama") {
    return `Sending to Ollama at ${status.ollama.base_url}.`;
  }
  return "Demo mode — replies are canned; no network calls are made.";
}

// ------------------------------ subcomponents ------------------------------

function ProviderBadge({
  status,
  provider,
}: {
  status: AIProviderStatus | null;
  provider: AIProvider;
}) {
  let label = "Demo mode";
  let tone: "neutral" | "ok" | "warn" = "neutral";
  if (!status) return null;
  if (provider === "openai") {
    if (status.openai.available) {
      label = "OpenAI live";
      tone = "ok";
    } else {
      label = status.openai.sdk ? "OpenAI (missing key)" : "OpenAI SDK missing";
      tone = "warn";
    }
  } else if (provider === "ollama") {
    label = `Ollama (${status.ollama.base_url})`;
    tone = "neutral";
  } else if (provider === "anthropic") {
    label = "Anthropic";
    tone = "neutral";
  }
  return (
    <span
      className={clsx(
        "rounded-full px-2.5 py-1 text-xs font-medium",
        tone === "ok" && "bg-emerald-50 text-emerald-700 border border-emerald-200",
        tone === "warn" && "bg-amber-50 text-amber-700 border border-amber-200",
        tone === "neutral" && "bg-ink-100 text-ink-700 border border-ink-200",
      )}
    >
      {label}
    </span>
  );
}

function ProviderCard(props: {
  status: AIProviderStatus | null;
  provider: AIProvider;
  onProviderChange: (p: AIProvider) => void;
  model: string;
  onModelChange: (m: string) => void;
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  ollamaBaseUrl: string;
  onOllamaBaseUrlChange: (u: string) => void;
  onTest: () => void;
  providerTest: { ok: boolean; message: string } | null;
}) {
  const { status, provider, onProviderChange, model, onModelChange } = props;

  return (
    <div className="card shrink-0 p-4">
      <div className="label mb-2">Provider</div>
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            { id: "demo", label: "Demo", enabled: true, hint: "No API calls" },
            {
              id: "openai",
              label: "OpenAI",
              enabled: !!status?.openai.available,
              hint: status?.openai.available
                ? "Live"
                : status?.openai.sdk
                  ? "No key"
                  : "No SDK",
            },
            {
              id: "anthropic",
              label: "Anthropic",
              enabled: true,
              hint: "Live",
            },
            {
              id: "ollama",
              label: "Ollama",
              enabled: true,
              hint: "Local",
            },
          ] as { id: AIProvider; label: string; enabled: boolean; hint: string }[]
        ).map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onProviderChange(p.id)}
            className={clsx(
              "rounded-md border px-2 py-2 text-left text-xs transition-colors",
              provider === p.id
                ? "border-brand-500 bg-brand-500 text-white"
                : "border-ink-200 bg-surface text-ink-700 hover:bg-ink-50",
              !p.enabled && provider !== p.id && "opacity-70",
            )}
          >
            <div className="font-semibold">{p.label}</div>
            <div
              className={clsx(
                "text-[10px]",
                provider === p.id ? "text-white/80" : "text-ink-500",
              )}
            >
              {p.hint}
            </div>
          </button>
        ))}
      </div>

      {provider !== "demo" && (
        <div className="mt-3">
          <label className="label mb-1 block">Model</label>
          <input
            className="input w-full"
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            placeholder={
              provider === "openai"
                ? status?.openai.default_model
                : provider === "anthropic"
                  ? status?.anthropic?.default_model || "claude-sonnet-4-20250514"
                : status?.ollama.default_model
            }
            spellCheck={false}
          />
        </div>
      )}

      {(provider === "openai" || provider === "anthropic") && (
        <div className="mt-3">
          <label className="label mb-1 block">API key</label>
          <input
            className="input w-full"
            value={props.apiKey}
            onChange={(e) => props.onApiKeyChange(e.target.value)}
            placeholder={provider === "openai" ? "sk-..." : "sk-ant-..."}
            type="password"
            spellCheck={false}
          />
          <p className="mt-1 text-[11px] text-amber-700">
            ⚠ Stored in browser localStorage as plaintext and sent directly from your browser to {provider === "openai" ? "OpenAI" : "Anthropic"}.
            Anyone with DevTools access on this device can read it. Use a key with a small monthly cap, and never share this browser profile.
          </p>
        </div>
      )}

      {provider === "ollama" && (
        <div className="mt-3">
          <label className="label mb-1 block">Ollama base URL</label>
          <input
            className="input w-full"
            value={props.ollamaBaseUrl}
            onChange={(e) => props.onOllamaBaseUrlChange(e.target.value)}
            placeholder="http://127.0.0.1:11434"
            spellCheck={false}
          />
          <p className="mt-1 text-[11px] text-ink-500">
            Requires a running <code>ollama</code> server; pull a model first
            (for example <code>ollama pull {status?.ollama.default_model || "llama3.1:8b"}</code>).
          </p>
        </div>
      )}

      {provider === "openai" && !status?.openai.available && (
        <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          The older backend chat endpoint has no OpenAI key, but this tool-calling view can use the browser API key field above.
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button type="button" className="btn-ghost text-xs" onClick={props.onTest}>
          Test
        </button>
        {props.providerTest && (
          <span
            className={clsx(
              "text-[11px]",
              props.providerTest.ok ? "text-emerald-700" : "text-red-700",
            )}
          >
            {props.providerTest.message}
          </span>
        )}
      </div>
    </div>
  );
}

function ContextCard(props: {
  context: AIContextSnapshot | null;
  activeModule: AIModuleName | "";
  onActiveModuleChange: (m: AIModuleName | "") => void;
  selectedSids: Set<string>;
  onToggleSession: (sid: string) => void;
  onClearSelection: () => void;
  includeContext: boolean;
  onIncludeContextChange: (v: boolean) => void;
  onRefresh: () => void;
}) {
  const {
    context,
    activeModule,
    onActiveModuleChange,
    selectedSids,
    onToggleSession,
    onClearSelection,
    includeContext,
    onIncludeContextChange,
    onRefresh,
  } = props;

  const moduleOptions: (AIModuleName | "")[] = ["", ...MODULE_NAMES];

  const sessions: AIContextSession[] = useMemo(() => {
    if (!context) return [];
    if (!activeModule) {
      return MODULE_NAMES.flatMap((m) => context[m]?.sessions || []);
    }
    return context[activeModule]?.sessions || [];
  }, [context, activeModule]);

  const summary: string = useMemo(() => {
    if (!context || !activeModule) return "Context uses sessions from all modules.";
    return context[activeModule]?.summary || "";
  }, [context, activeModule]);

  return (
    <div className="card shrink-0 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="label">Context</div>
        <Tooltip content="Refresh session list from server">
          <button type="button" className="btn-ghost text-xs" onClick={onRefresh}>
            Refresh
          </button>
        </Tooltip>
      </div>

      <label className="mb-2 flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={includeContext}
          onChange={(e) => onIncludeContextChange(e.target.checked)}
        />
        Include app context in prompt
      </label>

      <div className={clsx("transition-opacity", !includeContext && "pointer-events-none opacity-40")}>
        <label className="label mb-1 block">Focus module</label>
        <select
          className="input mb-2 w-full"
          value={activeModule}
          onChange={(e) => onActiveModuleChange(e.target.value as AIModuleName | "")}
          disabled={!includeContext}
        >
          {moduleOptions.map((m) => (
            <option key={m || "auto"} value={m}>
              {m || "Auto (any module)"}
            </option>
          ))}
        </select>

        <p className="mb-2 text-[11px] text-ink-500">{summary}</p>

        <div className="label mb-1 flex items-center justify-between">
          <span>
            Loaded sessions
            {selectedSids.size > 0 && (
              <span className="ml-1.5 rounded-full bg-brand-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                {selectedSids.size} selected
              </span>
            )}
          </span>
          {selectedSids.size > 0 && (
            <button
              type="button"
              className="text-[10px] font-medium text-ink-500 hover:text-ink-700"
              onClick={onClearSelection}
            >
              Clear
            </button>
          )}
        </div>
        {sessions.length === 0 ? (
          <div className="rounded border border-dashed border-ink-200 px-2 py-3 text-[11px] text-ink-500">
            No datasets loaded yet. Open another tab to upload a file, then Refresh here.
            <p className="mt-2 text-center text-[11px] text-ink-500">
              Open LCMS, FTIR, Plate Reader, or Data Studio to upload files.
            </p>
          </div>
        ) : (
          <div className="flex max-h-48 flex-col gap-1 overflow-y-auto pr-1">
            {sessions.map((s) => (
              <label
                key={s.session_id}
                className="flex cursor-pointer items-center gap-2 rounded border border-ink-200 px-2 py-1 text-xs hover:bg-ink-50"
              >
                <input
                  type="checkbox"
                  checked={selectedSids.has(s.session_id)}
                  onChange={() => onToggleSession(s.session_id)}
                  disabled={!includeContext}
                />
                <span className="truncate" title={s.display_name}>
                  {s.display_name}
                </span>
              </label>
            ))}
          </div>
        )}
        <p className="mt-2 text-[11px] text-ink-500">
          Selected sessions narrow the filenames sent as prompt context. If nothing is selected, all loaded filenames are included.
        </p>
      </div>
    </div>
  );
}

function AssistantSettingsCard({
  showToolTrace,
  onShowToolTraceChange,
  autoExecuteSafeActions,
  onAutoExecuteSafeActionsChange,
  actionCount,
  error,
}: {
  showToolTrace: boolean;
  onShowToolTraceChange: (value: boolean) => void;
  autoExecuteSafeActions: boolean;
  onAutoExecuteSafeActionsChange: (value: boolean) => void;
  actionCount: number;
  error: string | null;
}) {
  return (
    <div className="card shrink-0 p-4">
      <div className="label mb-2">Assistant tools</div>
      <label className="mb-2 flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={autoExecuteSafeActions}
          onChange={(e) => onAutoExecuteSafeActionsChange(e.target.checked)}
        />
        Auto-execute safe actions
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={showToolTrace}
          onChange={(e) => onShowToolTraceChange(e.target.checked)}
        />
        Show tool-call trace
      </label>
      <p className="mt-2 text-[11px] text-ink-500">
        {error ? `Action catalog error: ${error}` : `${actionCount} automation actions available.`}
      </p>
      <a
        href="/api/automation/logs"
        target="_blank"
        rel="noreferrer noopener"
        className="mt-2 inline-block text-[11px] text-ink-500 underline decoration-dotted hover:text-ink-700"
      >
        View backend action log →
      </a>
    </div>
  );
}

function EmptyTranscript({
  status,
  provider,
  onPick,
}: {
  status: AIProviderStatus | null;
  provider: AIProvider;
  onPick: (q: string) => void;
}) {
  const prompts = [
    "Create an EIC for m/z 150.1",
    "Integrate all visible EICs and show me the feature table",
    "Clear all EICs",
    "Open the Kendrick plot dialog",
  ];
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <div className="max-w-md">
        <h2 className="text-lg font-semibold text-ink-800">Ask anything about your lab workflows</h2>
        <p className="mt-1 text-sm text-ink-500">
          The assistant can explain modules, inspect loaded context, and call the same automation actions
          used by the app buttons.
        </p>
        {provider === "demo" && (
          <p className="mt-3 rounded border border-ink-200 bg-ink-50 px-3 py-2 text-xs text-ink-600">
            Currently in <strong>demo mode</strong> — replies are produced by literal
            keyword matching (no LLM, no intent understanding), so phrasing
            like <em>"don't clear EICs"</em> can still trigger the clear action.
            Switch provider in the left panel
            to use a live model{status?.openai.available ? "." : " (OpenAI requires an API key)."}
          </p>
        )}
      </div>
      <div className="grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-2">
        {prompts.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPick(p)}
            className="flex items-center justify-between gap-2 rounded-md border border-ink-200 bg-surface px-3 py-2 text-left text-xs text-ink-700 hover:border-ink-400 hover:bg-ink-50"
          >
            <span>{p}</span>
            <ArrowRightIcon className="h-3 w-3 shrink-0 text-ink-400" />
          </button>
        ))}
      </div>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-brand-500 px-3.5 py-2 text-sm text-white shadow-sm">
        {text}
      </div>
    </div>
  );
}

function AssistantBubble({
  turn,
  showTrace,
  onApprove,
  onReject,
  plotlyTheme,
}: {
  turn: ChatTurn;
  showTrace: boolean;
  onApprove: (turnId: string, eventId: string) => void;
  onReject: (turnId: string, eventId: string) => void;
  plotlyTheme: ReturnType<typeof usePlotlyTheme>;
}) {
  const [copied, setCopied] = useState(false);

  const copyContent = () => {
    void navigator.clipboard.writeText(turn.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    });
  };

  return (
    <div className="group flex justify-start">
      <div className="relative max-w-[85%] rounded-2xl rounded-bl-sm border border-ink-200 bg-surface px-3.5 py-2 text-sm text-ink-900 shadow-sm">
        <Tooltip content="Copy to clipboard">
          <button
            type="button"
            onClick={copyContent}
            aria-label="Copy message"
            className="absolute right-2 top-2 hidden rounded p-0.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700 group-hover:flex"
          >
            {copied ? <CheckIcon className="h-3.5 w-3.5 text-emerald-600" /> : <CopyIcon className="h-3.5 w-3.5" />}
          </button>
        </Tooltip>
        <div className="whitespace-pre-wrap pr-6">{turn.content}</div>
        {turn.toolEvents?.length ? (
          <div className="mt-3 flex flex-col gap-2">
            {turn.toolEvents.map((event) => (
              <ToolResultCard
                key={event.id}
                turnId={turn.id}
                event={event}
                showTrace={showTrace}
                onApprove={onApprove}
                onReject={onReject}
                plotlyTheme={plotlyTheme}
              />
            ))}
          </div>
        ) : null}
        {showTrace && turn.trace?.length ? (
          <details className="mt-2 rounded border border-ink-200 bg-ink-50 p-2 text-[11px]">
            <summary className="cursor-pointer font-medium text-ink-600">Tool-call trace</summary>
            <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap">
              {JSON.stringify(turn.trace, null, 2)}
            </pre>
          </details>
        ) : null}
        {(turn.is_mock || turn.error || turn.mode_hint || turn.used_context) && (
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-ink-100 pt-2 text-[10px] text-ink-500">
            {turn.mode_hint && <span>{turn.mode_hint}</span>}
            {turn.is_mock && (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">demo reply</span>
            )}
            {turn.used_context?.active_module && (
              <span className="rounded bg-ink-100 px-1.5 py-0.5">
                ctx: {turn.used_context.active_module}
                {turn.used_context.loaded_filenames.length > 0
                  ? ` · ${turn.used_context.loaded_filenames.length} file${
                      turn.used_context.loaded_filenames.length === 1 ? "" : "s"
                    }`
                  : ""}
              </span>
            )}
            {turn.error && (
              <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700" title={turn.error}>
                fallback: {truncate(turn.error, 60)}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolResultCard({
  turnId,
  event,
  showTrace,
  onApprove,
  onReject,
  plotlyTheme,
}: {
  turnId: string;
  event: ToolEvent;
  showTrace: boolean;
  onApprove: (turnId: string, eventId: string) => void;
  onReject: (turnId: string, eventId: string) => void;
  plotlyTheme: ReturnType<typeof usePlotlyTheme>;
}) {
  const dispatchAutomation = useAutomationDispatch();
  const eic = findEicPayload(event.result);
  const kendrick = findKendrickPayload(event.result);
  const featureRows = findFeatureRows(event.result);
  const csv = findCsvPayload(event.result);

  const openInUi = async () => {
    if (event.actionId === "lcms.create_eic_and_show" && hasStringProp(event.result, "eic_plot_id")) {
      await dispatchAutomation("lcms.scroll_to_eic", { eic_plot_id: String((event.result as Record<string, unknown>).eic_plot_id) });
      return;
    }
    if (eic) {
      await dispatchAutomation("lcms.push_eic_to_ui", {
        session_id: stringProp(event.args, "session_id"),
        eic,
        metadata: { source: "ai_assistant", action_id: event.actionId },
      });
    }
  };

  const addFeatureRow = async () => {
    if (!featureRows.length) return;
    await dispatchAutomation("lcms.add_feature_row", { row: featureRows[0] });
  };

  const openKendrick = async () => {
    await dispatchAutomation("lcms.open_dialog", { dialog: "kendrick" });
  };

  return (
    <div className="rounded-lg border border-ink-200 bg-ink-50 p-2 text-xs">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="font-semibold text-ink-700">{event.actionId}</span>
          <span className={clsx("ml-2 rounded px-1.5 py-0.5 text-[10px]", statusClass(event.status))}>
            {event.status}
          </span>
        </div>
        <span className="shrink-0 text-[10px] uppercase text-ink-500">{event.risk}</span>
      </div>

      {event.status === "pending" && (
        <div className="space-y-2">
          <PreviewSummary event={event} />
          <div className="flex gap-2">
            <button type="button" className="btn-primary text-xs" onClick={() => onApprove(turnId, event.id)}>
              {event.risk === "destructive" ? "Approve (destructive)" : "Approve"}
            </button>
            <button type="button" className="btn-ghost text-xs" onClick={() => onReject(turnId, event.id)}>
              Reject
            </button>
          </div>
        </div>
      )}

      {event.status === "error" && <div className="text-red-700">{event.error}</div>}
      {event.status === "rejected" && <div className="text-ink-600">Rejected.</div>}

      {event.status === "ran" && (
        <div className="space-y-2">
          {eic && <MiniEicPlot eic={eic} plotlyTheme={plotlyTheme} />}
          {kendrick && <MiniKendrickPlot payload={kendrick} plotlyTheme={plotlyTheme} />}
          {featureRows.length > 0 && <MiniFeatureTable rows={featureRows} />}
          {csv && <CsvDownload csv={csv} actionId={event.actionId} />}

          <div className="flex flex-wrap gap-2">
            {eic && (
              <button type="button" className="btn-ghost text-xs" onClick={() => { void openInUi(); }}>
                Open in UI
              </button>
            )}
            {featureRows.length > 0 && (
              <button type="button" className="btn-ghost text-xs" onClick={() => { void addFeatureRow(); }}>
                Add to Feature Table
              </button>
            )}
            {kendrick && (
              <button type="button" className="btn-ghost text-xs" onClick={() => { void openKendrick(); }}>
                Open Kendrick Dialog
              </button>
            )}
          </div>

          {!eic && !kendrick && !featureRows.length && !csv && (
            <details className="rounded border border-ink-200 bg-white p-2">
              <summary className="cursor-pointer font-medium text-ink-600">JSON result</summary>
              <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap text-[10px]">
                {JSON.stringify(event.result ?? {}, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}

      {showTrace && (
        <details className="mt-2 rounded border border-ink-200 bg-white p-2">
          <summary className="cursor-pointer text-[11px] font-medium text-ink-600">Arguments</summary>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[10px]">
            {JSON.stringify(event.args, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

function PreviewSummary({ event }: { event: ToolEvent }) {
  const preview = (event.preview ?? {}) as Record<string, unknown>;
  const affected =
    Array.isArray(preview.affected_session_ids)
      ? (preview.affected_session_ids as string[])
      : [];
  const warnings = Array.isArray(preview.warnings) ? (preview.warnings as string[]) : [];
  const estMs = typeof preview.estimated_duration_ms === "number"
    ? Math.round(preview.estimated_duration_ms as number)
    : null;
  const expires = typeof preview.expires_at === "string" ? (preview.expires_at as string) : null;
  const argsCount = Object.keys(event.args ?? {}).length;
  return (
    <div className={clsx(
      "rounded border px-2 py-2 text-[11px]",
      event.risk === "destructive" ? "border-red-300 bg-red-50 text-red-900" : "border-amber-300 bg-amber-50 text-amber-900",
    )}>
      <div className="font-semibold">
        {event.risk === "destructive" ? "Destructive action" : "Confirm action"}: {event.actionId}
      </div>
      <ul className="mt-1 space-y-0.5">
        <li>Arguments: {argsCount} field{argsCount === 1 ? "" : "s"}</li>
        {affected.length > 0 && <li>Affects sessions: {affected.join(", ")}</li>}
        {estMs != null && <li>Estimated duration: ~{estMs} ms</li>}
        {expires && <li>Approval token expires: {new Date(expires).toLocaleTimeString()}</li>}
        {warnings.map((w, i) => <li key={i} className="text-red-700">⚠ {w}</li>)}
      </ul>
      <details className="mt-1">
        <summary className="cursor-pointer text-[10px] text-ink-500">Raw preview JSON</summary>
        <pre className="mt-1 max-h-36 overflow-auto rounded bg-white p-2 text-[10px] text-ink-700">
          {JSON.stringify(event.preview ?? {}, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function MiniEicPlot({
  eic,
  plotlyTheme,
}: {
  eic: Record<string, unknown>;
  plotlyTheme: ReturnType<typeof usePlotlyTheme>;
}) {
  const x = numberArray(eic.rt_min);
  const y = numberArray(eic.intensity);
  const data: Data[] = [{ x, y, type: "scatter", mode: "lines", line: { color: plotlyTheme.colorway[0], width: 1.5 } }];
  return <MiniPlot data={data} yTitle="Intensity" plotlyTheme={plotlyTheme} />;
}

function MiniKendrickPlot({
  payload,
  plotlyTheme,
}: {
  payload: Record<string, unknown>;
  plotlyTheme: ReturnType<typeof usePlotlyTheme>;
}) {
  const points = Array.isArray(payload.points) ? payload.points : [];
  const x = points.map((point) => Number((point as Record<string, unknown>).mz ?? 0));
  const y = points.map((point) => Number((point as Record<string, unknown>).kmd ?? (point as Record<string, unknown>).kendrick_mass_defect ?? 0));
  const data: Data[] = [{ x, y, type: "scatter", mode: "markers", marker: { color: plotlyTheme.colorway[1], size: 5 } }];
  return <MiniPlot data={data} yTitle="KMD" plotlyTheme={plotlyTheme} />;
}

function MiniPlot({
  data,
  yTitle,
  plotlyTheme,
}: {
  data: Data[];
  yTitle: string;
  plotlyTheme: ReturnType<typeof usePlotlyTheme>;
}) {
  const layout: Partial<Layout> = {
    height: 150,
    margin: { l: 38, r: 8, t: 8, b: 28 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { size: 10, color: plotlyTheme.fontColor },
    xaxis: { title: "RT / m/z", showgrid: true, gridcolor: plotlyTheme.gridColor },
    yaxis: { title: yTitle, showgrid: true, gridcolor: plotlyTheme.gridColor },
    showlegend: false,
  };
  return (
    <div className="h-[150px] rounded border border-ink-200 bg-white">
      <Plot data={data} layout={layout} config={{ displayModeBar: false, responsive: true }} className="h-full w-full" />
    </div>
  );
}

function MiniFeatureTable({ rows }: { rows: Record<string, unknown>[] }) {
  const keys = Object.keys(rows[0] ?? {}).slice(0, 5);
  return (
    <div className="max-h-36 overflow-auto rounded border border-ink-200 bg-white">
      <table className="min-w-full text-left text-[11px]">
        <thead className="bg-ink-50 text-ink-500">
          <tr>{keys.map((key) => <th key={key} className="px-2 py-1 font-medium">{key}</th>)}</tr>
        </thead>
        <tbody>
          {rows.slice(0, 5).map((row, idx) => (
            <tr key={idx} className="border-t border-ink-100">
              {keys.map((key) => <td key={key} className="px-2 py-1">{formatCell(row[key])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CsvDownload({ csv, actionId }: { csv: string; actionId: string }) {
  return (
    <a
      className="btn-ghost inline-flex text-xs"
      href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`}
      download={`${actionId.replace(/\W+/g, "-")}.csv`}
    >
      Download CSV
    </a>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm border border-ink-200 bg-surface px-3.5 py-2 text-sm text-ink-500 shadow-sm">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-400" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-400 [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-400 [animation-delay:300ms]" />
        <span className="ml-2 text-xs">Thinking…</span>
      </div>
    </div>
  );
}

function Composer(props: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onCancel: () => void;
  busy: boolean;
  hint: string;
}) {
  const { value, onChange, onSend, onCancel, busy, hint } = props;
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div>
      <div className="flex items-end gap-2">
        <textarea
          ref={ref}
          className="input min-h-[40px] flex-1 resize-none"
          placeholder="Message the assistant… (Shift+Enter for newline)"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          disabled={busy}
        />
        {busy ? (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel in-flight request"
            title="Cancel"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500 text-white transition-colors hover:bg-red-600"
          >
            <SpinnerIcon className="h-4 w-4 animate-spin" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSend}
            disabled={!value.trim()}
            aria-label="Send message"
            title="Send (Enter)"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-ink-300"
          >
            <SendIcon className="h-4 w-4" />
          </button>
        )}
      </div>
      {hint && <div className="mt-1 text-[11px] text-ink-500">{hint}</div>}
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function unwrapResult(value: unknown): unknown {
  if (value && typeof value === "object" && "result" in value) return (value as Record<string, unknown>).result;
  return value;
}

function findEicPayload(value: unknown): Record<string, unknown> | null {
  const root = unwrapResult(value);
  if (!root || typeof root !== "object") return null;
  const obj = root as Record<string, unknown>;
  const eic = obj.eic && typeof obj.eic === "object" ? (obj.eic as Record<string, unknown>) : obj;
  return Array.isArray(eic.rt_min) && Array.isArray(eic.intensity) ? eic : null;
}

function findKendrickPayload(value: unknown): Record<string, unknown> | null {
  const root = unwrapResult(value);
  if (!root || typeof root !== "object") return null;
  const obj = root as Record<string, unknown>;
  return Array.isArray(obj.points) ? obj : null;
}

function findFeatureRows(value: unknown): Record<string, unknown>[] {
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

function findCsvPayload(value: unknown): string | null {
  const root = unwrapResult(value);
  if (!root || typeof root !== "object") return null;
  const obj = root as Record<string, unknown>;
  const csv = obj.csv ?? obj.csv_text ?? obj.content;
  return typeof csv === "string" && csv.includes(",") ? csv : null;
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number).filter((item) => Number.isFinite(item)) : [];
}

function statusClass(status: ToolEvent["status"]): string {
  if (status === "ran") return "bg-emerald-50 text-emerald-700";
  if (status === "pending") return "bg-amber-50 text-amber-700";
  if (status === "error") return "bg-red-50 text-red-700";
  return "bg-ink-100 text-ink-600";
}

function formatCell(value: unknown): string {
  if (typeof value === "number") return Number.isFinite(value) ? value.toPrecision(5) : "";
  if (typeof value === "string") return truncate(value, 28);
  if (value == null) return "";
  return truncate(JSON.stringify(value), 28);
}

function stringProp(value: unknown, key: string): string | null {
  return value && typeof value === "object" && typeof (value as Record<string, unknown>)[key] === "string"
    ? String((value as Record<string, unknown>)[key])
    : null;
}

function hasStringProp(value: unknown, key: string): value is Record<string, string> {
  return !!value && typeof value === "object" && typeof (value as Record<string, unknown>)[key] === "string";
}

function SendIcon({ className }: { className?: string }) {
  // Paper-plane silhouette, centered in a 24×24 viewBox.
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M3.4 20.6a1 1 0 0 1-1.35-1.2l2.3-6.4a1 1 0 0 1 .8-.65L13 11l-7.85-1.35a1 1 0 0 1-.8-.65L2.05 2.6A1 1 0 0 1 3.4 1.4l17.8 8.7a1 1 0 0 1 0 1.8L3.4 20.6z" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.2-8.55" />
    </svg>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}
