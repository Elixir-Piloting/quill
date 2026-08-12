import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isEnabled as autoStartIsEnabled, enable as autoStartEnable, disable as autoStartDisable } from "@tauri-apps/plugin-autostart";
import type { Update } from "@tauri-apps/plugin-updater";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { X, Loader2, AlertTriangle } from "lucide-react";
import Popup from "./Popup";
import FormPopup from "./FormPopup";
import Titlebar from "./components/Titlebar";
import SettingsModal from "./components/SettingsModal";
import MainPage from "./pages/MainPage";
import UpdateDialog from "./components/UpdateDialog";
function App() {
  return (
    <MemoryRouter>
      <Routes>
        <Route path="*" element={<AppShell />} />
      </Routes>
    </MemoryRouter>
  );
}

// ── Types ──

export type SubmitKey = "enter" | "shift_enter" | "ctrl_enter" | "tab";

export interface SubmitOnCompletion {
  enabled: boolean;
  key: SubmitKey;
  delay_ms: number;
}

export interface Snippet {
  id: number;
  trigger: string;
  expansion: string;
  whole_word: boolean;
  app_scope: string;
  submit_on_completion: SubmitOnCompletion | null;
  folder_id: number | null;
  created_at: string;
}

export interface Folder {
  id: number;
  name: string;
  color: string;
  created_at: string;
}

export interface Variable {
  id: number;
  name: string;
  value: string;
  kind: string;
  folder_id: number | null;
  created_at: string;
}

export type VarKind = "text" | "date" | "clipboard";

// ── App shell ──

function AppShell() {
  const [paused, setPaused] = useState(false);

  // Theme (runs in all windows including popup)
  const [theme, setTheme] = useState<"system" | "light" | "dark">(() => {
    const stored = localStorage.getItem("quill-theme");
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
    return "system";
  });

  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      if (theme === "light") root.classList.remove("dark");
      else if (theme === "dark") root.classList.add("dark");
      else if (mq.matches) root.classList.add("dark");
      else root.classList.remove("dark");
    };
    apply();
    localStorage.setItem("quill-theme", theme);
    if (theme === "system") {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme]);

  // Popup redirect
  try {
    const win = getCurrentWindow();
    if (win.label === "form") return <FormPopup />;
    if (win.label !== "main") return <Popup />;
  } catch {}

  // Snippets
  const [snippets, setSnippets] = useState<Snippet[]>([]);

  async function loadSnippets() {
    setSnippets(await invoke<Snippet[]>("get_snippets"));
  }

  // Variables
  const [variables, setVariables] = useState<Variable[]>([]);

  async function loadVariables() {
    setVariables(await invoke<Variable[]>("get_variables"));
  }

  // Settings
  const [settingsDlg, setSettingsDlg] = useState(false);

  // Update dialog
  const [update, setUpdate] = useState<Update | null>(null);

  // Script expansion indicator / error toast
  const [scriptExpanding, setScriptExpanding] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const scriptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unlisten = listen<{ running: boolean; error?: string }>("script-expansion", (e) => {
      const { running, error } = e.payload;
      if (scriptTimer.current) {
        clearTimeout(scriptTimer.current);
        scriptTimer.current = null;
      }
      if (running) {
        setScriptError(null);
        // Only show the indicator if the expansion takes a noticeable while
        scriptTimer.current = setTimeout(() => setScriptExpanding(true), 300);
      } else {
        setScriptExpanding(false);
        if (error) {
          setScriptError(error);
          scriptTimer.current = setTimeout(() => setScriptError(null), 10000);
        }
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  // Settings state
  const [closeToTray, setCloseToTray] = useState(() => localStorage.getItem("quill-close-to-tray") !== "false");
  const [runOnBoot, setRunOnBoot] = useState(() => localStorage.getItem("quill-run-on-boot") === "true");
  const [bootPriority, setBootPriority] = useState(() => localStorage.getItem("quill-boot-priority") || "normal");

  useEffect(() => { localStorage.setItem("quill-close-to-tray", String(closeToTray)); }, [closeToTray]);
  useEffect(() => {
    localStorage.setItem("quill-run-on-boot", String(runOnBoot));
    if (runOnBoot) autoStartEnable().catch(() => {});
    else autoStartDisable().catch(() => {});
  }, [runOnBoot]);
  useEffect(() => { localStorage.setItem("quill-boot-priority", bootPriority); }, [bootPriority]);

  // Hotkey
  const [hotkey, setHotkeyState] = useState("Alt+Space");

  useEffect(() => {
    invoke<string>("get_hotkey").then(setHotkeyState).catch(() => {});
  }, []);

  function changeHotkey(hk: string) {
    setHotkeyState(hk);
    invoke("set_hotkey", { hotkey: hk }).catch(() => {});
  }

  // Init
  useEffect(() => {
    loadSnippets();
    loadVariables();
    invoke<boolean>("get_paused").then(setPaused);
    autoStartIsEnabled().then((enabled) => setRunOnBoot(enabled)).catch(() => {});
    if (!import.meta.env.DEV) {
      import("@tauri-apps/plugin-updater")
        .then(({ check }) => check())
        .then((result) => {
          if (result) setUpdate(result);
        })
        .catch((e) => console.error("[updater] check failed", e));
    }
    const unlisten = listen<boolean>("paused-changed", (e) => setPaused(e.payload));
    return () => { unlisten.then((f) => f()); };
  }, []);

  async function togglePause() {
    setPaused(await invoke<boolean>("toggle_paused"));
  }

  return (
    <div className="flex h-screen flex-col">
      <Titlebar paused={paused} closeToTray={closeToTray} onTogglePause={togglePause} onOpenSettings={() => setSettingsDlg(true)} />

      <MainPage snippets={snippets} variables={variables} onRefreshSnippets={loadSnippets} onRefreshVariables={loadVariables} />

      {update && (
        <UpdateDialog update={update} onClose={() => setUpdate(null)} />
      )}

      {scriptExpanding && (
        <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl border bg-popover px-4 py-2.5 shadow-xl ring-1 ring-border">
          <Loader2 className="size-4 animate-spin text-primary" />
          <span className="text-xs font-medium">Expanding…</span>
        </div>
      )}

      {scriptError && (
        <div className="fixed bottom-4 right-4 z-50 flex w-80 items-start gap-3 rounded-xl border bg-popover p-4 shadow-xl ring-1 ring-border">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-destructive">Script failed</p>
            <p className="mt-1 text-xs text-muted-foreground">{scriptError}</p>
          </div>
          <button onClick={() => setScriptError(null)} className="shrink-0 text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
      )}

      <SettingsModal
        open={settingsDlg}
        defaultTab="general"
        onClose={() => setSettingsDlg(false)}
        theme={theme}
        onChangeTheme={setTheme}
        closeToTray={closeToTray}
        onChangeCloseToTray={setCloseToTray}
        runOnBoot={runOnBoot}
        onChangeRunOnBoot={setRunOnBoot}
        bootPriority={bootPriority}
        onChangeBootPriority={setBootPriority}
        hotkey={hotkey}
        onChangeHotkey={changeHotkey}
        onRefreshSnippets={loadSnippets}
      />
    </div>
  );
}

export default App;
