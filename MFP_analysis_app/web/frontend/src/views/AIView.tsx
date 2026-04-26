import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  api,
  AIAssistantMessage,
  AIContextSession,
  AIContextSnapshot,
  AIModuleName,
  AIProvider,
  AIProviderStatus,
} from "../api";
import { PageHeaderContent, usePageHeader } from "../layout/PageHeader";

const MODULE_NAMES: AIModuleName[] = ["LCMS", "FTIR", "Plate Reader", "Data Studio"];

interface ChatTurn extends AIAssistantMessage {
  id: string;
  mode_hint?: string;
  is_mock?: boolean;
  error?: string | null;
  used_context?: {
    active_module: string;
    loaded_filenames: string[];
    module_summary: string;
  } | null;
}

function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function AIView() {
  const [status, setStatus] = useState<AIProviderStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [provider, setProvider] = useState<AIProvider>("demo");
  const [model, setModel] = useState<string>("");
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState<string>("");

  const [context, setContext] = useState<AIContextSnapshot | null>(null);
  const [activeModule, setActiveModule] = useState<AIModuleName | "">("");
  const [selectedSids, setSelectedSids] = useState<Set<string>>(new Set());
  const [includeContext, setIncludeContext] = useState(true);

  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.ai
      .status()
      .then((s) => {
        setStatus(s);
        setProvider(s.default);
        setModel(
          s.default === "openai"
            ? s.openai.default_model
            : s.default === "ollama"
              ? s.ollama.default_model
              : "",
        );
        setOllamaBaseUrl(s.ollama.base_url || "http://127.0.0.1:11434");
      })
      .catch((e) => setStatusError(String(e)));
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
    else if (next === "ollama") setModel(status.ollama.default_model);
    else setModel("demo");
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

  const send = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    setError(null);

    const userTurn: ChatTurn = { id: genId("u"), role: "user", content: trimmed };
    const nextTurns = [...turns, userTurn];
    setTurns(nextTurns);
    setInput("");
    setBusy(true);

    try {
      const resp = await api.ai.chat({
        messages: nextTurns.map((t) => ({ role: t.role, content: t.content })),
        provider,
        model: model || null,
        active_module: activeModule || null,
        session_ids: Array.from(selectedSids),
        include_context: includeContext,
        ollama_base_url: provider === "ollama" ? ollamaBaseUrl || null : null,
      });

      const assistantTurn: ChatTurn = {
        id: genId("a"),
        role: "assistant",
        content: resp.response.text || "(empty response)",
        mode_hint: resp.mode_hint,
        is_mock: resp.response.is_mock,
        error: resp.response.error ?? null,
        used_context: resp.used_context,
      };
      setTurns((prev) => [...prev, assistantTurn]);
    } catch (e) {
      setError(String(e));
      setTurns((prev) => prev.slice(0, -1));
      setInput(trimmed);
    } finally {
      setBusy(false);
    }
  }, [
    activeModule,
    busy,
    includeContext,
    input,
    model,
    ollamaBaseUrl,
    provider,
    selectedSids,
    turns,
  ]);

  const resetChat = () => {
    setTurns([]);
    setError(null);
  };

  usePageHeader(
    <PageHeaderContent
      title="AI Assistant"
      subtitle="Ask about FTIR, LCMS, plate reader, data studio workflows, or general lab-analysis concepts. Read-only — the assistant cannot modify your data."
      actions={<ProviderBadge status={status} provider={provider} />}
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
            ollamaBaseUrl={ollamaBaseUrl}
            onOllamaBaseUrlChange={setOllamaBaseUrl}
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
        </aside>

        <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-ink-200 bg-white shadow-card">
          <div className="flex shrink-0 items-center justify-between border-b border-ink-200 px-4 py-2">
            <div className="text-xs text-ink-500">
              {turns.length === 0
                ? "No messages yet — ask a question below."
                : `${turns.filter((t) => t.role === "user").length} message${
                    turns.filter((t) => t.role === "user").length === 1 ? "" : "s"
                  }`}
            </div>
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={resetChat}
              disabled={turns.length === 0 || busy}
            >
              Clear chat
            </button>
          </div>

          <div
            ref={transcriptRef}
            className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
          >
            {turns.length === 0 ? (
              <EmptyTranscript
                status={status}
                provider={provider}
                onPick={(q) => setInput(q)}
              />
            ) : (
              turns.map((t) =>
                t.role === "user" ? (
                  <UserBubble key={t.id} text={t.content} />
                ) : (
                  <AssistantBubble key={t.id} turn={t} />
                ),
              )
            )}
            {busy && <TypingIndicator />}
          </div>

          <div className="shrink-0 border-t border-ink-200 bg-white px-4 py-3">
            {error && (
              <div className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            )}
            <Composer
              value={input}
              onChange={setInput}
              onSend={send}
              busy={busy}
              hint={composerHint(provider, status)}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function composerHint(provider: AIProvider, status: AIProviderStatus | null): string {
  if (!status) return "";
  if (provider === "openai") {
    return status.openai.available
      ? "OpenAI key detected — live model in use."
      : "OpenAI unavailable: set OPENAI_API_KEY or switch provider.";
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
  ollamaBaseUrl: string;
  onOllamaBaseUrlChange: (u: string) => void;
}) {
  const { status, provider, onProviderChange, model, onModelChange } = props;

  return (
    <div className="card shrink-0 p-4">
      <div className="label mb-2">Provider</div>
      <div className="grid grid-cols-3 gap-2">
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
                : "border-ink-200 bg-white text-ink-700 hover:bg-ink-50",
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
                : status?.ollama.default_model
            }
            spellCheck={false}
          />
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
          {status?.openai.sdk
            ? "Set the OPENAI_API_KEY environment variable for the backend process, then restart the server."
            : "The OpenAI Python SDK is not installed on the backend. Add 'openai' to requirements and restart."}
        </div>
      )}
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
        <button type="button" className="btn-ghost text-xs" onClick={onRefresh}>
          Refresh
        </button>
      </div>

      <label className="mb-2 flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={includeContext}
          onChange={(e) => onIncludeContextChange(e.target.checked)}
        />
        Include app context in prompt
      </label>

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
        <span>Loaded sessions</span>
        {selectedSids.size > 0 && (
          <button
            type="button"
            className="text-[10px] font-medium text-ink-500 hover:text-ink-700"
            onClick={onClearSelection}
          >
            Clear ({selectedSids.size})
          </button>
        )}
      </div>
      {sessions.length === 0 ? (
        <div className="rounded border border-dashed border-ink-200 px-2 py-3 text-[11px] text-ink-500">
          No datasets loaded yet. Open another tab to upload a file, then Refresh here.
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
    "What's the difference between absorbance and transmittance in FTIR?",
    "How do I interpret an MIC curve from the plate reader?",
    "Summarise what the LCMS tab computes for TIC and MS1.",
    "What does the Data Studio log transform do to zero or negative values?",
  ];
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <div className="max-w-md">
        <h2 className="text-lg font-semibold text-ink-800">Ask anything about your lab workflows</h2>
        <p className="mt-1 text-sm text-ink-500">
          The assistant can explain modules, analysis concepts, and the files you have loaded.
          It never modifies data or runs analyses on its own.
        </p>
        {provider === "demo" && (
          <p className="mt-3 rounded border border-ink-200 bg-ink-50 px-3 py-2 text-xs text-ink-600">
            Currently in <strong>demo mode</strong>. Switch to OpenAI or Ollama in the left panel
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
            className="rounded-md border border-ink-200 bg-white px-3 py-2 text-left text-xs text-ink-700 hover:border-ink-400 hover:bg-ink-50"
          >
            {p}
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

function AssistantBubble({ turn }: { turn: ChatTurn }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-ink-200 bg-white px-3.5 py-2 text-sm text-ink-800 shadow-sm">
        <div className="whitespace-pre-wrap">{turn.content}</div>
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

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm border border-ink-200 bg-white px-3.5 py-2 text-sm text-ink-500 shadow-sm">
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
  busy: boolean;
  hint: string;
}) {
  const { value, onChange, onSend, busy, hint } = props;
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
        <button
          type="button"
          onClick={onSend}
          disabled={busy || !value.trim()}
          aria-label={busy ? "Sending message" : "Send message"}
          title={busy ? "Sending…" : "Send (Enter)"}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-ink-300"
        >
          {busy ? (
            <SpinnerIcon className="h-4 w-4 animate-spin" />
          ) : (
            <SendIcon className="h-4 w-4" />
          )}
        </button>
      </div>
      {hint && <div className="mt-1 text-[11px] text-ink-500">{hint}</div>}
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
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
