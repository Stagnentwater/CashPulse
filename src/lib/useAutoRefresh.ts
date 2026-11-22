import { useEffect, useRef } from "react";

/**
 * Calls `refresh` every `intervalMs`, on window focus, and when the tab becomes visible again.
 * Does not call `refresh` on mount; the page is expected to load its data on mount.
 */
export function useAutoRefresh(refresh: () => void, intervalMs = 4000): void {
  const refreshRef = useRef(refresh);

  // Latest-ref pattern: the ref is updated in an effect, not during render.
  useEffect(() => {
    refreshRef.current = refresh;
  });

  useEffect(() => {
    const tick = () => refreshRef.current();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") tick();
    };
    const onManualRefresh = () => tick();

    const id = window.setInterval(tick, intervalMs);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("cashpulse:refresh", onManualRefresh);

    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("cashpulse:refresh", onManualRefresh);
    };
  }, [intervalMs]);
}
