import { useCallback, useEffect, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";

type Theme = "system" | "light" | "dark";
const STORAGE_KEY = "quill-theme";
const THEME_EVENT = "theme-changed";

function isTheme(value: unknown): value is Theme {
  return value === "system" || value === "light" || value === "dark";
}

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const refresh = () => setTheme(readTheme());
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refresh);
    void listen<Theme>(THEME_EVENT, ({ payload }) => {
      if (isTheme(payload)) setTheme(payload);
    }).then((stop) => {
      if (disposed) stop();
      else {
        unlisten = stop;
        // Catch changes made while this window was registering its listener.
        refresh();
      }
    }).catch((error) => console.warn("Unable to listen for theme changes", error));

    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const changeTheme = useCallback((next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next);
    setTheme(next);
    void emit(THEME_EVENT, next).catch((error) => {
      console.warn("Unable to broadcast theme changes", error);
    });
  }, []);

  return [theme, changeTheme] as const;
}
