import { useCallback, useEffect, useRef, useState } from "react";

export interface UseUndoRedoOptions {
  maxHistory?: number;
  enableKeyShortcuts?: boolean;
}

export interface UseUndoRedoReturn<T> {
  state: T;
  set: (nextOrUpdater: T | ((prev: T) => T), recordHistory?: boolean) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  reset: (newInitial: T) => void;
}

export function useUndoRedo<T>(
  initialState: T,
  options?: UseUndoRedoOptions,
): UseUndoRedoReturn<T> {
  const maxHistory = options?.maxHistory ?? 40;
  const enableKeyShortcuts = options?.enableKeyShortcuts ?? true;

  const [present, setPresent] = useState<T>(initialState);
  const pastRef = useRef<T[]>([]);
  const futureRef = useRef<T[]>([]);
  const presentRef = useRef<T>(initialState);
  presentRef.current = present;

  const set = useCallback(
    (nextOrUpdater: T | ((prev: T) => T), recordHistory = true) => {
      const current = presentRef.current;
      const next =
        typeof nextOrUpdater === "function"
          ? (nextOrUpdater as (prev: T) => T)(current)
          : nextOrUpdater;

      if (Object.is(current, next)) return;

      if (recordHistory) {
        pastRef.current = [...pastRef.current.slice(-(maxHistory - 1)), current];
        futureRef.current = [];
      }
      setPresent(next);
    },
    [maxHistory],
  );

  const undo = useCallback(() => {
    if (pastRef.current.length === 0) return;

    const previous = pastRef.current[pastRef.current.length - 1];
    const newPast = pastRef.current.slice(0, pastRef.current.length - 1);

    futureRef.current = [presentRef.current, ...futureRef.current];
    pastRef.current = newPast;
    setPresent(previous);
  }, []);

  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return;

    const next = futureRef.current[0];
    const newFuture = futureRef.current.slice(1);

    pastRef.current = [...pastRef.current, presentRef.current];
    futureRef.current = newFuture;
    setPresent(next);
  }, []);

  const reset = useCallback((newInitial: T) => {
    pastRef.current = [];
    futureRef.current = [];
    setPresent(newInitial);
  }, []);

  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;

  useEffect(() => {
    if (!enableKeyShortcuts) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        (activeEl instanceof HTMLElement && activeEl.isContentEditable);

      if (isInput) return;

      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      if (!isCtrlOrCmd) return;

      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        if (pastRef.current.length > 0) {
          e.preventDefault();
          undo();
        }
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        if (futureRef.current.length > 0) {
          e.preventDefault();
          redo();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enableKeyShortcuts, undo, redo]);

  return {
    state: present,
    set,
    undo,
    redo,
    canUndo,
    canRedo,
    reset,
  };
}
