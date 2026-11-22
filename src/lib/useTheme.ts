"use client";

import { useSyncExternalStore } from "react";

export type ThemeMode = "white" | "dark" | "neon";

const STORAGE_KEY = "cashpulse_theme";

export function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "white";
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    if (stored === "white" || stored === "dark" || stored === "neon") {
      return stored;
    }
  } catch {
    // Ignore storage errors
  }
  return "white";
}

export function applyTheme(theme: ThemeMode) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Ignore storage errors
  }
  window.dispatchEvent(new CustomEvent("cashpulse:theme-change", { detail: theme }));
}

function subscribe(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  const handler = () => callback();
  window.addEventListener("cashpulse:theme-change", handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener("cashpulse:theme-change", handler);
    window.removeEventListener("storage", handler);
  };
}

export function useTheme() {
  const theme = useSyncExternalStore<ThemeMode>(
    subscribe,
    getStoredTheme,
    () => "white"
  );

  const setTheme = (next: ThemeMode) => {
    applyTheme(next);
  };

  return { theme, setTheme };
}
