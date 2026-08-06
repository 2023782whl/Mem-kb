import { useCallback, useEffect, useState } from "react";
import { usePersistentBoolean } from "./usePersistentState";

export function useDockedPanel(storageKey: string) {
  const [pinned, setPinned] = usePersistentBoolean(storageKey, false);
  const [open, setOpen] = useState(() => pinned);

  useEffect(() => {
    if (pinned) setOpen(true);
  }, [pinned]);

  useEffect(() => {
    if (!open || pinned) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, pinned]);

  const openPanel = useCallback(() => setOpen(true), []);
  const closePanel = useCallback(() => {
    setOpen(false);
    setPinned(false);
  }, [setPinned]);
  const closeTemporaryPanel = useCallback(() => {
    if (!pinned) setOpen(false);
  }, [pinned]);
  const togglePinned = useCallback(() => {
    setPinned((current) => {
      const next = !current;
      if (next) setOpen(true);
      return next;
    });
  }, [setPinned]);

  return { open, pinned, openPanel, closePanel, closeTemporaryPanel, togglePinned };
}
