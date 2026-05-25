import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";

export type AutomationArgs = Record<string, unknown>;
export type AutomationResult = Record<string, unknown> | void;
export type BrowserAutomationHandler = (args: AutomationArgs) => AutomationResult | Promise<AutomationResult>;

interface BrowserAutomationContextValue {
  register: (actionId: string, handler: BrowserAutomationHandler) => () => void;
  dispatchLocal: (actionId: string, args: AutomationArgs) => Promise<Record<string, unknown>>;
}

const BrowserAutomationContext = createContext<BrowserAutomationContextValue | null>(null);

function browserId() {
  // sessionStorage (NOT localStorage) so each browser tab gets its own id.
  // With localStorage two tabs would share an id and continuously supersede
  // each other on the backend bridge — the "single-tab wins" policy would
  // kick both out in turn. sessionStorage persists across page reloads in
  // the same tab but is unique per tab.
  const key = "mfp.automation.browserId";
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const next = crypto.randomUUID();
    window.sessionStorage.setItem(key, next);
    return next;
  } catch {
    return crypto.randomUUID();
  }
}

function bridgeUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL("/api/automation/browser-bridge", window.location.href);
  url.protocol = protocol;
  url.searchParams.set("browser_id", browserId());
  return url.toString();
}

export function BrowserBridgeProvider({ children }: { children: ReactNode }) {
  const handlersRef = useRef(new Map<string, BrowserAutomationHandler>());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const closedRef = useRef(false);

  const register = useCallback((actionId: string, handler: BrowserAutomationHandler) => {
    handlersRef.current.set(actionId, handler);
    return () => {
      const current = handlersRef.current.get(actionId);
      if (current === handler) handlersRef.current.delete(actionId);
    };
  }, []);

  const dispatchLocal = useCallback(async (actionId: string, args: AutomationArgs) => {
    const handler = handlersRef.current.get(actionId);
    if (!handler) throw new Error(`No browser handler registered for ${actionId}`);
    return ((await handler(args)) ?? {}) as Record<string, unknown>;
  }, []);

  const send = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(payload));
  }, []);

  const connect = useCallback(() => {
    if (closedRef.current) return;
    const ws = new WebSocket(bridgeUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttemptRef.current = 0;
    };

    ws.onmessage = (event) => {
      void (async () => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(String(event.data)) as Record<string, unknown>;
        } catch {
          return;
        }

        if (message.type === "ping") {
          send({ type: "pong", ts: Date.now() });
          return;
        }

        if (message.type !== "automation_request") return;
        const requestId = String(message.request_id ?? "");
        const actionId = String(message.action_id ?? "");
        const args = (message.args && typeof message.args === "object" ? message.args : {}) as AutomationArgs;
        const handler = handlersRef.current.get(actionId);

        if (!handler) {
          send({
            type: "automation_response",
            request_id: requestId,
            error: `No browser handler registered for ${actionId}`,
          });
          return;
        }

        try {
          const result = (await handler(args)) ?? {};
          send({ type: "automation_response", request_id: requestId, result });
        } catch (err) {
          send({
            type: "automation_response",
            request_id: requestId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })();
    };

    const scheduleReconnect = () => {
      if (closedRef.current) return;
      if (wsRef.current === ws) wsRef.current = null;
      if (reconnectTimerRef.current !== null) return;
      const attempt = reconnectAttemptRef.current;
      reconnectAttemptRef.current += 1;
      const delay = Math.min(10000, 500 * 2 ** attempt);
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    };

    ws.onclose = scheduleReconnect;
    ws.onerror = scheduleReconnect;
  }, [send]);

  useEffect(() => {
    closedRef.current = false;
    connect();
    return () => {
      closedRef.current = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  const value = useMemo(() => ({ register, dispatchLocal }), [dispatchLocal, register]);
  return <BrowserAutomationContext.Provider value={value}>{children}</BrowserAutomationContext.Provider>;
}

export function useBrowserAutomation() {
  const value = useContext(BrowserAutomationContext);
  if (!value) {
    throw new Error("useBrowserAutomation must be used within BrowserBridgeProvider");
  }
  return value;
}
