import { useCallback, useEffect, useRef } from "react";

export const AUTOSAVE_DELAY_MS = 3_000;

/**
 * Calls `save` `delayMs` after the last change of `revision` while `enabled`.
 * Returns `flush`, which saves a pending change at once; unmounting flushes too.
 */
export function useAutosave(
  revision: unknown,
  enabled: boolean,
  save: () => void,
  delayMs: number = AUTOSAVE_DELAY_MS,
): () => void {
  const saveRef = useRef(save);
  saveRef.current = save;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const cancel = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };

  const flush = useCallback(() => {
    if (timer.current === undefined) return;
    cancel();
    saveRef.current();
  }, []);

  // Declared before the countdown effect: on unmount this cleanup runs first and saves.
  useEffect(() => flush, [flush]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` restarts the countdown on every change.
  useEffect(() => {
    if (!enabled) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      saveRef.current();
    }, delayMs);
    return cancel;
  }, [revision, enabled, delayMs]);

  return flush;
}
