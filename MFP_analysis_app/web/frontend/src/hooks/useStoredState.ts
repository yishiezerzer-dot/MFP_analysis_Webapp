import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

function readStoredValue<T>(
  key: string,
  fallback: T,
  reconcile?: (value: any) => T,
): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw);
    return reconcile ? reconcile(parsed) : (parsed as T);
  } catch {
    return fallback;
  }
}

export function useStoredState<T>(
  key: string,
  fallback: T,
  reconcile?: (value: any) => T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => readStoredValue(key, fallback, reconcile));

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Best-effort persistence; the UI still works when storage is unavailable.
    }
  }, [key, value]);

  return [value, setValue];
}
