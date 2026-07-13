import { useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { Button } from "@/components/ui/button";
import { ExternalLink, Download } from "lucide-react";
import HotkeyRecorder from "./HotkeyRecorder";

type Theme = "system" | "light" | "dark";

interface Props {
  open: boolean;
  onClose: () => void;
  theme: Theme;
  onChangeTheme: (t: Theme) => void;
  closeToTray: boolean;
  onChangeCloseToTray: (v: boolean) => void;
  runOnBoot: boolean;
  onChangeRunOnBoot: (v: boolean) => void;
  bootPriority: string;
  onChangeBootPriority: (v: string) => void;
  hotkey: string;
  onChangeHotkey: (hk: string) => void;
}

type Tab = "general" | "hotkey" | "about";

function SettingsModal(props: Props) {
  const [tab, setTab] = useState<Tab>("general");

  if (!props.open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onMouseDown={props.onClose}>
      <div className="flex h-[420px] w-[520px] overflow-hidden rounded-xl bg-popover shadow-2xl ring-1 ring-border" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex w-36 flex-col gap-1 border-r bg-muted/30 p-3">
          {(["general", "hotkey", "about"] as Tab[]).map((t) => (
            <button
              key={t}
              className={`rounded-md px-3 py-2 text-left text-xs font-medium transition-colors ${
                tab === t ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setTab(t)}
            >
              {{ general: "General", hotkey: "Hotkey", about: "About" }[t]}
            </button>
          ))}
        </div>
        <div className="flex flex-1 flex-col">
          <div className="flex-1 overflow-y-auto p-5">
            {tab === "general" && <GeneralTab {...props} />}
            {tab === "hotkey" && <HotkeyTab {...props} />}
            {tab === "about" && <AboutTab />}
          </div>
          <div className="flex justify-end border-t px-5 py-3">
            <Button variant="outline" size="sm" onClick={props.onClose}>Close</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GeneralTab({ theme, onChangeTheme, closeToTray, onChangeCloseToTray, runOnBoot, onChangeRunOnBoot, bootPriority, onChangeBootPriority }: Props) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Theme</label>
        <div className="flex gap-2">
          {(["system", "light", "dark"] as const).map((t) => (
            <Button key={t} variant={theme === t ? "default" : "outline"} size="sm" onClick={() => onChangeTheme(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-sm font-medium">Close to tray</span>
          <span className="text-xs text-muted-foreground">Minimize to tray instead of quitting</span>
        </div>
        <Button variant={closeToTray ? "default" : "outline"} size="sm" onClick={() => onChangeCloseToTray(!closeToTray)}>
          {closeToTray ? "On" : "Off"}
        </Button>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-sm font-medium">Run on boot</span>
          <span className="text-xs text-muted-foreground">Auto-start Quill when you log in</span>
        </div>
        <Button variant={runOnBoot ? "default" : "outline"} size="sm" onClick={() => onChangeRunOnBoot(!runOnBoot)}>
          {runOnBoot ? "On" : "Off"}
        </Button>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Boot priority</label>
        <div className="flex gap-2">
          {(["low", "normal", "high"] as const).map((p) => (
            <Button key={p} variant={bootPriority === p ? "default" : "outline"} size="sm" onClick={() => onChangeBootPriority(p)}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

function HotkeyTab({ hotkey, onChangeHotkey }: Props) {
  return (
    <div className="flex flex-col gap-5">
      <HotkeyRecorder hotkey={hotkey} onChange={onChangeHotkey} />
    </div>
  );
}

function AboutTab() {
  const [updateState, setUpdateState] = useState<"idle" | "checking" | "available" | "downloading" | "done" | "none">("idle");
  const [updateInfo, setUpdateInfo] = useState<{ version: string; body?: string } | null>(null);

  async function checkForUpdates() {
    setUpdateState("checking");
    try {
      const update = await check();
      if (update) {
        setUpdateInfo({ version: update.version, body: update.body });
        setUpdateState("available");
      } else {
        setUpdateState("none");
      }
    } catch {
      setUpdateState("none");
    }
  }

  async function downloadAndInstall() {
    setUpdateState("downloading");
    try {
      const update = await check();
      if (update) {
        await update.downloadAndInstall();
        setUpdateState("done");
      }
    } catch {}
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Quill by <strong>Elixir-Piloting</strong></span>
        <a href="https://github.com/Elixir-Piloting" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
          GitHub <ExternalLink className="size-3" />
        </a>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">v0.1.0</span>
        <Button variant="outline" size="xs" onClick={checkForUpdates} disabled={updateState === "checking"}>
          {updateState === "checking" ? "Checking..." : updateState === "none" ? "No updates found" : updateState === "available" ? "Update available" : updateState === "done" ? "Installed" : "Check for Updates"}
        </Button>
      </div>
      {updateInfo && updateState === "available" && (
        <div className="flex flex-col gap-2">
          {updateInfo.body && (
            <div className="max-h-32 overflow-y-auto rounded-md bg-muted p-3 text-xs text-muted-foreground whitespace-pre-wrap">
              {updateInfo.body}
            </div>
          )}
          <Button variant="default" size="sm" onClick={downloadAndInstall}>
            <Download /> Download &amp; Install
          </Button>
        </div>
      )}
    </div>
  );
}

export default SettingsModal;
