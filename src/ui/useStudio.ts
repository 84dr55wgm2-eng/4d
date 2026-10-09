import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Studio, StudioUI } from '../runtime/Studio';

export function useStudioUI(studio: Studio): StudioUI {
  return useSyncExternalStore(
    (cb) => studio.on('ui', cb),
    () => studio.ui,
  );
}

/** Re-render on world-document changes (entities, shots). */
export function useDocVersion(studio: Studio) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!studio.store) return;
    return studio.store.on('change', () => setV((x) => x + 1));
  }, [studio, studio.store]);
  return v;
}

/** Poll a value at an interval (diagnostics). */
export function usePoll<T>(fn: () => T, ms: number, enabled = true): T {
  const [v, setV] = useState(fn);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setV(fn()), ms);
    return () => clearInterval(id);
  }, [enabled, ms]); // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}
