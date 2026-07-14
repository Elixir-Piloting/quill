import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import { check } from "@tauri-apps/plugin-updater";
import { Button } from "@/components/ui/button";
import { ExternalLink, Download, UploadIcon, DownloadIcon } from "lucide-react";
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
  onRefreshSnippets: () => void;
}

type Tab = "general" | "hotkey" | "about";

interface ImportPreview {
  snippet_count: number;
  variable_count: number;
  form_input_count: number;
  version: number;
  is_version_future: boolean;
}

interface ImportResult {
  snippets_imported: number;
  variables_imported: number;
  form_inputs_imported: number;
  duplicates_skipped: number;
}

interface StarterPackInfo {
  name: string;
  key: string;
  description: string;
  emoji: string;
}

interface StarterPackResult {
  snippets_added: number;
  duplicates_skipped: number;
}

const starterPacks: StarterPackInfo[] = [
  {
    name: "Emoji",
    key: "emoji",
    description: "60 common emoji shortcodes like :smile:, :heart:, :rocket:",
    emoji: "😊",
  },
];

function SettingsModal(props: Props) {
  const [tab, setTab] = useState<Tab>("general");
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importFilePath, setImportFilePath] = useState<string>("");
  const [importError, setImportError] = useState<string>("");
  const [importing, setImporting] = useState(false);
  const [installingPack, setInstallingPack] = useState<string | null>(null);
  const [packResults, setPackResults] = useState<Record<string, StarterPackResult>>({});

  if (!props.open) return null;

  async function handleExport() {
    try {
      const path = await save({
        filters: [{ name: "Quill Export", extensions: ["json"] }],
        defaultPath: "quill-export.json",
      });
      if (!path) return;
      await invoke("export_data", { path });
    } catch (e) {
      console.error("Export failed:", e);
    }
  }

  async function handleImport() {
    setImportError("");
    setImportPreview(null);
    setImportResult(null);
    setImportMode("merge");
    setReplaceConfirmed(false);

    try {
      const path = await open({
        filters: [{ name: "Quill Export", extensions: ["json"] }],
        multiple: false,
      });
      if (!path) return;
      setImportFilePath(path as string);
      const preview: ImportPreview = await invoke("validate_import", { path });
      setImportPreview(preview);
    } catch (e) {
      setImportError(String(e));
    }
  }

  async function confirmImport() {
    if (!importFilePath || importing) return;
    setImporting(true);
    setImportError("");
    try {
      const result: ImportResult = await invoke("execute_import", {
        path: importFilePath,
        mode: importMode,
      });
      setImportResult(result);
      props.onRefreshSnippets();
    } catch (e) {
      setImportError(String(e));
    } finally {
      setImporting(false);
    }
  }

  function closeImportDialog() {
    setImportPreview(null);
    setImportResult(null);
    setImportError("");
    setImportFilePath("");
    setImportMode("merge");
    setReplaceConfirmed(false);
  }

  async function installPack(key: string) {
    setInstallingPack(key);
    try {
      const result: StarterPackResult = await invoke("install_starter_pack", { name: key });
      setPackResults((prev) => ({ ...prev, [key]: result }));
      props.onRefreshSnippets();
    } catch (e) {
      console.error("Failed to install starter pack:", e);
    } finally {
      setInstallingPack(null);
    }
  }

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
            {tab === "general" && (
              <GeneralTab
                {...props}
                onExport={handleExport}
                onImport={handleImport}
                installingPack={installingPack}
                packResults={packResults}
                onInstallPack={installPack}
              />
            )}
            {tab === "hotkey" && <HotkeyTab {...props} />}
            {tab === "about" && <AboutTab />}
          </div>
          <div className="flex justify-end border-t px-5 py-3">
            <Button variant="outline" size="sm" onClick={props.onClose}>Close</Button>
          </div>
        </div>
      </div>

      {/* Import preview dialog */}
      {(importPreview || importResult || importError) && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onMouseDown={closeImportDialog}>
          <div className="w-[420px] rounded-xl bg-popover p-5 shadow-2xl ring-1 ring-border" onMouseDown={(e) => e.stopPropagation()}>
            {importError && !importPreview && !importResult && (
              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold">Import Error</h3>
                <p className="text-xs text-destructive">{importError}</p>
                <Button variant="outline" size="sm" onClick={closeImportDialog}>Close</Button>
              </div>
            )}

            {importResult && (
              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold">Import Complete</h3>
                <p className="text-xs text-muted-foreground">
                  Imported {importResult.snippets_imported} snippets, {importResult.variables_imported} variables, {importResult.form_inputs_imported} form inputs.
                  {importResult.duplicates_skipped > 0 && (
                    <> {importResult.duplicates_skipped} duplicates skipped.</>
                  )}
                </p>
                <Button variant="outline" size="sm" onClick={closeImportDialog}>OK</Button>
              </div>
            )}

            {importPreview && !importResult && (
              <div className="flex flex-col gap-4">
                <h3 className="text-sm font-semibold">Import Preview</h3>

                {importPreview.is_version_future && (
                  <div className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
                    This export file uses format v{importPreview.version}, which is newer than the currently supported v1.
                    Some data may not import correctly.
                  </div>
                )}

                <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                  <p>Snippets: <span className="font-medium text-foreground">{importPreview.snippet_count}</span></p>
                  <p>Variables: <span className="font-medium text-foreground">{importPreview.variable_count}</span></p>
                  <p>Form inputs: <span className="font-medium text-foreground">{importPreview.form_input_count}</span></p>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="radio"
                      name="importMode"
                      checked={importMode === "merge"}
                      onChange={() => { setImportMode("merge"); setReplaceConfirmed(false); }}
                      className="size-3.5 accent-primary"
                    />
                    Merge — add alongside existing items (duplicates skipped)
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="radio"
                      name="importMode"
                      checked={importMode === "replace"}
                      onChange={() => { setImportMode("replace"); setReplaceConfirmed(false); }}
                      className="size-3.5 accent-primary"
                    />
                    Replace all — wipe existing data first
                  </label>
                  {importMode === "replace" && (
                    <label className="flex items-center gap-2 pl-5 text-xs text-destructive">
                      <input
                        type="checkbox"
                        checked={replaceConfirmed}
                        onChange={(e) => setReplaceConfirmed(e.target.checked)}
                        className="size-3.5 accent-destructive"
                      />
                      I understand this will delete all current snippets and variables
                    </label>
                  )}
                </div>

                {importError && (
                  <p className="text-xs text-destructive">{importError}</p>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={closeImportDialog}>Cancel</Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={confirmImport}
                    disabled={importing || (importMode === "replace" && !replaceConfirmed)}
                  >
                    {importing ? "Importing..." : "Import"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function GeneralTab({ onExport, onImport, installingPack, packResults, onInstallPack, ...props }: Props & { onExport: () => void; onImport: () => void; installingPack: string | null; packResults: Record<string, StarterPackResult>; onInstallPack: (key: string) => void }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Theme</label>
        <div className="flex gap-2">
          {(["system", "light", "dark"] as const).map((t) => (
            <Button key={t} variant={props.theme === t ? "default" : "outline"} size="sm" onClick={() => props.onChangeTheme(t)}>
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
        <Button variant={props.closeToTray ? "default" : "outline"} size="sm" onClick={() => props.onChangeCloseToTray(!props.closeToTray)}>
          {props.closeToTray ? "On" : "Off"}
        </Button>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-sm font-medium">Run on boot</span>
          <span className="text-xs text-muted-foreground">Auto-start Quill when you log in</span>
        </div>
        <Button variant={props.runOnBoot ? "default" : "outline"} size="sm" onClick={() => props.onChangeRunOnBoot(!props.runOnBoot)}>
          {props.runOnBoot ? "On" : "Off"}
        </Button>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Boot priority</label>
        <div className="flex gap-2">
          {(["low", "normal", "high"] as const).map((p) => (
            <Button key={p} variant={props.bootPriority === p ? "default" : "outline"} size="sm" onClick={() => props.onChangeBootPriority(p)}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </Button>
          ))}
        </div>
      </div>
      <div className="border-t pt-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Import / Export</label>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onExport}>
              <DownloadIcon className="size-3.5" /> Export Snippets
            </Button>
            <Button variant="outline" size="sm" onClick={onImport}>
              <UploadIcon className="size-3.5" /> Import Snippets
            </Button>
          </div>
        </div>
      </div>

      <div className="border-t pt-4">
        <div className="flex flex-col gap-3">
          <label className="text-xs font-medium text-muted-foreground">Starter Packs</label>
          {starterPacks.map((pack) => {
            const result = packResults[pack.key];
            return (
              <div key={pack.key} className="flex items-center gap-3 rounded-lg border bg-card p-3">
                <span className="text-2xl">{pack.emoji}</span>
                <div className="flex-1">
                  <div className="text-sm font-medium">{pack.name}</div>
                  <div className="text-xs text-muted-foreground">{pack.description}</div>
                </div>
                {result ? (
                  <div className="text-xs text-muted-foreground whitespace-nowrap">
                    {result.snippets_added} added
                    {result.duplicates_skipped > 0 && `, ${result.duplicates_skipped} skipped`}
                  </div>
                ) : (
                  <Button
                    variant="default"
                    size="xs"
                    onClick={() => onInstallPack(pack.key)}
                    disabled={installingPack === pack.key}
                  >
                    {installingPack === pack.key ? "Adding..." : "Add"}
                  </Button>
                )}
              </div>
            );
          })}
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
