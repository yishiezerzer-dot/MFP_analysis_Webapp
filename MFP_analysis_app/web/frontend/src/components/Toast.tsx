import { createContext, ReactNode, useCallback, useContext, useRef, useState } from "react";

type ToastKind = "success" | "error" | "warning" | "info";

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
  leaving: boolean;
}

interface ToastContextValue {
  toast: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const ICONS: Record<ToastKind, string> = {
  success: "✓",
  error:   "✕",
  warning: "⚠",
  info:    "i",
};

const BG: Record<ToastKind, string> = {
  success: "bg-emerald-500",
  error:   "bg-red-500",
  warning: "bg-amber-500",
  info:    "bg-brand-500",
};

const BORDER: Record<ToastKind, string> = {
  success: "border-emerald-500/20",
  error:   "border-red-500/20",
  warning: "border-amber-500/20",
  info:    "border-brand-500/20",
};

let nextId = 1;
const DISMISS_MS = 4000;
const LEAVE_MS   = 180;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    const leaveTimer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, LEAVE_MS);
    timers.current.set(id, leaveTimer);
  }, []);

  const toast = useCallback((message: string, kind: ToastKind = "info") => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, kind, leaving: false }]);
    const autoTimer = setTimeout(() => dismiss(id), DISMISS_MS);
    timers.current.set(id, autoTimer);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-5 right-5 z-50 flex flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-[8px] shadow-md px-3 py-2.5 min-w-[240px] max-w-sm bg-white border ${BORDER[t.kind]} ${t.leaving ? "toast-leave" : "toast-enter"}`}
          >
            <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${BG[t.kind]}`}>
              {ICONS[t.kind]}
            </span>
            <span className="flex-1 text-[12px] text-ink-700 leading-snug">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 mt-0.5 text-ink-400 hover:text-ink-700 text-[16px] leading-none transition-colors"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
