import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isEnabled as autoStartIsEnabled, enable as autoStartEnable, disable as autoStartDisable } from "@tauri-apps/plugin-autostart";
import { check } from "@tauri-apps/plugin-updater";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { X } from "lucide-react";
import Popup from "./Popup";
import FormPopup from "./FormPopup";
import Titlebar from "./components/Titlebar";
import SettingsModal from "./components/SettingsModal";
import MainPage from "./pages/MainPage";
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

export interface Snippet {
  id: number;
  trigger: string;
  expansion: string;
  whole_word: boolean;
  app_scope: string;
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
  const [settingsDefaultTab, setSettingsDefaultTab] = useState<"general" | "hotkey" | "about">("general");

  // Update toast
  const [updateToast, setUpdateToast] = useState<{ version: string; body?: string } | null>(null);

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
    check().then((update) => {
      if (update) setUpdateToast({ version: update.version, body: update.body });
    }).catch(() => {});
    const unlisten = listen<boolean>("paused-changed", (e) => setPaused(e.payload));
    return () => { unlisten.then((f) => f()); };
  }, []);

  async function togglePause() {
    setPaused(await invoke<boolean>("toggle_paused"));
  }

  function openSettingsToAbout() {
    setSettingsDefaultTab("about");
    setSettingsDlg(true);
  }

  return (
    <div className="flex h-screen flex-col">
      <Titlebar paused={paused} closeToTray={closeToTray} onTogglePause={togglePause} onOpenSettings={() => setSettingsDlg(true)} />

      <MainPage snippets={snippets} variables={variables} onRefreshSnippets={loadSnippets} onRefreshVariables={loadVariables} />

      {updateToast && (
        <div className="fixed bottom-4 right-4 z-50 flex w-80 items-start gap-3 rounded-xl border bg-popover p-4 shadow-xl ring-1 ring-border">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Update {updateToast.version} available</p>
            {updateToast.body && (
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{updateToast.body}</p>
            )}
            <button
              onClick={() => { openSettingsToAbout(); }}
              className="mt-2 text-xs font-medium text-primary hover:underline"
            >
              See Update
            </button>
          </div>
          <button onClick={() => setUpdateToast(null)} className="shrink-0 text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
      )}

      <SettingsModal
        open={settingsDlg}
        defaultTab={settingsDefaultTab}
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
