import { useCallback, useState } from "react";

function readValue<T>(key: string, fallback: T, parse: (value: string) => T) {
  try {
    const stored = window.localStorage.getItem(key);
    return stored === null ? fallback : parse(stored);
  } catch {
    return fallback;
  }
}

function persistValue(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Layout preferences may be unavailable in private browser contexts.
  }
}

export function usePersistentBoolean(key: string, fallback: boolean) {
  const [value, setValue] = useState(() => readValue(key, fallback, (stored) => stored === "1"));
  const update = useCallback((next: boolean | ((current: boolean) => boolean)) => {
    setValue((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      persistValue(key, resolved ? "1" : "0");
      return resolved;
    });
  }, [key]);
  return [value, update] as const;
}

export function usePersistentNumber(key: string, fallback: number, min: number, max: number) {
  const clamp = useCallback((value: number) => Math.min(max, Math.max(min, Math.round(value))), [max, min]);
  const [value, setValue] = useState(() => readValue(key, fallback, (stored) => {
    const parsed = Number(stored);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
  }));
  const update = useCallback((next: number | ((current: number) => number)) => {
    setValue((current) => {
      const resolved = clamp(typeof next === "function" ? next(current) : next);
      persistValue(key, resolved);
      return resolved;
    });
  }, [clamp, key]);
  return [value, update] as const;
}
