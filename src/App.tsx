import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isEnabled as autoStartIsEnabled, enable as autoStartEnable, disable as autoStartDisable } from "@tauri-apps/plugin-autostart";
import Popup from "./Popup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { check } from "@tauri-apps/plugin-updater";
import { PlusIcon, PencilIcon, Trash2Icon, Settings, Minus, Square, Copy, X, ExternalLink, Download } from "lucide-react";

// ── Types ──

interface Snippet {
  id: number;
  trigger: string;
  expansion: string;
  whole_word: boolean;
  created_at: string;
}

interface Variable {
  id: number;
  name: string;
  value: string;
  kind: string;
  created_at: string;
}

type VarKind = "text" | "date" | "clipboard";

interface DateFormatOption {
  label: string;
  pattern: string;
}

const DATE_FORMATS: DateFormatOption[] = [
  { label: "2026-07-13",          pattern: "%Y-%m-%d" },
  { label: "13/07/2026",          pattern: "%d/%m/%Y" },
  { label: "07/13/2026",          pattern: "%m/%d/%Y" },
  { label: "July 13, 2026",       pattern: "%B %d, %Y" },
  { label: "13 July 2026",        pattern: "%d %B %Y" },
  { label: "Jul 13, 2026",        pattern: "%b %d, %Y" },
  { label: "13 Jul 2026",         pattern: "%d %b %Y" },
  { label: "July 13",             pattern: "%B %d" },
  { label: "13 July",             pattern: "%d %B" },
  { label: "Jul 13",              pattern: "%b %d" },
  { label: "13 Jul",              pattern: "%d %b" },
  { label: "Mon, Jul 13",         pattern: "%a, %b %d" },
  { label: "Monday, July 13",     pattern: "%A, %B %d" },
  { label: "Monday",              pattern: "%A" },
  { label: "Mon",                 pattern: "%a" },
  { label: "2026-07",             pattern: "%Y-%m" },
  { label: "July 2026",           pattern: "%B %Y" },
  { label: "14:30",               pattern: "%H:%M" },
  { label: "2:30 PM",             pattern: "%I:%M %p" },
  { label: "14:30:00",            pattern: "%H:%M:%S" },
  { label: "2:30:00 PM",          pattern: "%I:%M:%S %p" },
  { label: "2026-07-13 14:30",    pattern: "%Y-%m-%d %H:%M" },
  { label: "07/13/2026 2:30 PM",  pattern: "%m/%d/%Y %I:%M %p" },
  { label: "13/07/2026 14:30",    pattern: "%d/%m/%Y %H:%M" },
];

function previewDate(pattern: string): string {
  const d = new Date();
  const map: Record<string, string> = {
    "%Y": String(d.getFullYear()),
    "%y": String(d.getFullYear()).slice(-2),
    "%m": String(d.getMonth() + 1).padStart(2, "0"),
    "%d": String(d.getDate()).padStart(2, "0"),
    "%H": String(d.getHours()).padStart(2, "0"),
    "%I": String(d.getHours() % 12 || 12).padStart(2, "0"),
    "%M": String(d.getMinutes()).padStart(2, "0"),
    "%S": String(d.getSeconds()).padStart(2, "0"),
    "%p": d.getHours() < 12 ? "AM" : "PM",
    "%B": d.toLocaleDateString("en-US", { month: "long" }),
    "%b": d.toLocaleDateString("en-US", { month: "short" }),
    "%A": d.toLocaleDateString("en-US", { weekday: "long" }),
    "%a": d.toLocaleDateString("en-US", { weekday: "short" }),
  };
  let out = pattern;
  for (const [k, v] of Object.entries(map)) out = out.split(k).join(v);
  return out;
}

// ── App ──

function App() {
  const [paused, setPaused] = useState(false);

  // Theme (runs in all windows including popup)
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>(() => {
    const stored = localStorage.getItem('quill-theme');
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
    return 'system';
  });

  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      if (theme === 'light') { root.classList.remove('dark'); }
      else if (theme === 'dark') { root.classList.add('dark'); }
      else if (mq.matches) { root.classList.add('dark'); }
      else { root.classList.remove('dark'); }
    };
    apply();
    localStorage.setItem('quill-theme', theme);
    if (theme === 'system') {
      const handler = () => apply();
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [theme]);

  // If we're in the search popup window, render the popup UI
  try {
    const win = getCurrentWindow();
    if (win.label !== 'main') {
      return <Popup />;
    }
  } catch {}

  // Tabs
  const [tab, setTab] = useState<'snippets' | 'variables'>('snippets');

  // Snippets
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [snippetDlg, setSnippetDlg] = useState(false);
  const [editingSnip, setEditingSnip] = useState<Snippet | null>(null);
  const [trigger, setTrigger] = useState("");
  const [expansion, setExpansion] = useState("");
  const [wholeWord, setWholeWord] = useState(true);
  const expansionRef = useRef<HTMLTextAreaElement>(null);

  // Settings
  const [settingsDlg, setSettingsDlg] = useState(false);

  // Confirm dialog
  const [confirmDlg, setConfirmDlg] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ type: 'snippet' | 'variable'; id: number; label: string } | null>(null);

  // Settings state
  const [closeToTray, setCloseToTray] = useState(() => localStorage.getItem('quill-close-to-tray') !== 'false');
  const [runOnBoot, setRunOnBoot] = useState(() => localStorage.getItem('quill-run-on-boot') === 'true');
  const [bootPriority, setBootPriority] = useState(() => localStorage.getItem('quill-boot-priority') || 'normal');

  // Hotkey
  const [hotkey, setHotkeyState] = useState("Alt+Space");
  const [recordingHotkey, setRecordingHotkey] = useState(false);

  useEffect(() => {
    invoke<string>("get_hotkey").then(setHotkeyState).catch(() => {});
  }, []);

  function changeHotkey(hk: string) {
    setHotkeyState(hk);
    invoke("set_hotkey", { hotkey: hk }).catch(() => {});
  }

  function startRecording() {
    setRecordingHotkey(true);
  }

  useEffect(() => {
    if (!recordingHotkey) return;
    function handler(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      const mods: string[] = [];
      if (e.ctrlKey) mods.push("Ctrl");
      if (e.altKey) mods.push("Alt");
      if (e.shiftKey) mods.push("Shift");
      if (e.metaKey) mods.push("Super");
      let key = "";
      if (e.key === " ") key = "Space";
      else if (e.key === "Escape") key = "Escape";
      else if (e.key === "Enter") key = "Enter";
      else if (e.key === "Tab") key = "Tab";
      else if (e.key.startsWith("F") && e.key.length <= 3) key = e.key;
      else if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key)) key = e.key.toUpperCase();
      else return;
      if (mods.length === 0) return;
      const combo = [...mods, key].join("+");
      setRecordingHotkey(false);
      changeHotkey(combo);
    }
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [recordingHotkey]);

  // Update
  const [updateDlg, setUpdateDlg] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{ version: string; body?: string } | null>(null);
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'available' | 'downloading' | 'done' | 'none'>('idle');

  async function checkForUpdates() {
    setUpdateState('checking');
    try {
      const update = await check();
      if (update) {
        setUpdateInfo({ version: update.version, body: update.body });
        setUpdateState('available');
        setUpdateDlg(true);
      } else {
        setUpdateState('none');
      }
    } catch {
      setUpdateState('none');
    }
  }

  async function downloadAndInstall() {
    setUpdateState('downloading');
    try {
      const update = await check();
      if (update) {
        await update.downloadAndInstall();
      }
    } catch {
      // fall through
    }
    setUpdateState('idle');
  }

  useEffect(() => { localStorage.setItem('quill-close-to-tray', String(closeToTray)); }, [closeToTray]);
  useEffect(() => {
    localStorage.setItem('quill-run-on-boot', String(runOnBoot));
    if (runOnBoot) { autoStartEnable().catch(() => {}); }
    else { autoStartDisable().catch(() => {}); }
  }, [runOnBoot]);
  useEffect(() => { localStorage.setItem('quill-boot-priority', bootPriority); }, [bootPriority]);

  // Variables
  const [variables, setVariables] = useState<Variable[]>([]);
  const [variableDlg, setVariableDlg] = useState(false);
  const [editingVar, setEditingVar] = useState<Variable | null>(null);
  const [varName, setVarName] = useState("");
  const [varKind, setVarKind] = useState<VarKind>("text");
  const [varValue, setVarValue] = useState("");
  const [varDateFmt, setVarDateFmt] = useState("");

  // Init
  useEffect(() => {
    loadSnippets();
    loadVariables();
    invoke<boolean>("get_paused").then(setPaused);
    autoStartIsEnabled().then((enabled) => setRunOnBoot(enabled)).catch(() => {});
    const unlisten = listen<boolean>("paused-changed", (e) => setPaused(e.payload));
    return () => { unlisten.then((f) => f()); };
  }, []);

  // ── Window controls ──
  const appWindow = getCurrentWindow();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    appWindow.isMaximized().then(setMaximized);
    const unlisten = appWindow.onResized(() => { appWindow.isMaximized().then(setMaximized); });
    return () => { unlisten.then((f) => f()); };
  }, []);

  function minimizeWindow() { appWindow.minimize(); }
  function toggleMaximize() { appWindow.toggleMaximize(); }
  function closeWindow() {
    if (closeToTray) { appWindow.hide(); }
    else { appWindow.close(); }
  }

  // ── Snippets ──

  async function loadSnippets() {
    setSnippets(await invoke<Snippet[]>("get_snippets"));
  }

  function openNewSnippet() {
    setEditingSnip(null);
    setTrigger("");
    setExpansion("");
    setWholeWord(true);
    setSnippetDlg(true);
  }

  function openEditSnippet(s: Snippet) {
    setEditingSnip(s);
    setTrigger(s.trigger);
    setExpansion(s.expansion);
    setWholeWord(s.whole_word);
    setSnippetDlg(true);
  }

  async function saveSnippet() {
    if (!trigger.trim() || !expansion.trim()) return;
    if (editingSnip) {
      await invoke("update_snippet", { id: editingSnip.id, trigger: trigger.trim(), expansion: expansion.trim(), wholeWord });
    } else {
      await invoke("add_snippet", { trigger: trigger.trim(), expansion: expansion.trim(), wholeWord });
    }
    setSnippetDlg(false);
    loadSnippets();
  }

  function requestDelete(type: 'snippet' | 'variable', id: number, label: string) {
    setPendingDelete({ type, id, label });
    setConfirmDlg(true);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    if (pendingDelete.type === 'snippet') {
      await invoke("delete_snippet", { id: pendingDelete.id });
      loadSnippets();
    } else {
      await invoke("delete_variable", { id: pendingDelete.id });
      loadVariables();
    }
    setConfirmDlg(false);
    setPendingDelete(null);
  }

  function insertVariable(name: string) {
    const ta = expansionRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const placeholder = `{${name}}`;
    setExpansion(expansion.slice(0, start) + placeholder + expansion.slice(end));
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + placeholder.length, start + placeholder.length);
    });
  }

  // ── Variables ──

  async function loadVariables() {
    setVariables(await invoke<Variable[]>("get_variables"));
  }

  function openNewVariable() {
    setEditingVar(null);
    setVarName("");
    setVarKind("text");
    setVarValue("");
    setVarDateFmt("");
    setVariableDlg(true);
  }

  function openEditVariable(v: Variable) {
    setEditingVar(v);
    setVarName(v.name);
    setVarKind(v.kind as VarKind);
    if (v.kind === "date") {
      setVarDateFmt(v.value);
      setVarValue("");
    } else {
      setVarValue(v.value);
      setVarDateFmt("");
    }
    setVariableDlg(true);
  }

  async function saveVariable() {
    if (!varName.trim()) return;
    const finalValue = varKind === "date" ? varDateFmt : varValue;
    const payload = { name: varName.trim(), value: finalValue, kind: varKind };
    if (editingVar) {
      await invoke("update_variable", { id: editingVar.id, ...payload });
    } else {
      await invoke("add_variable", payload);
    }
    setVariableDlg(false);
    loadVariables();
  }

  // ── Pause ──

  async function togglePause() {
    setPaused(await invoke<boolean>("toggle_paused"));
  }

  // ── Helpers ──

  function varDisplay(v: Variable): string {
    if (v.kind === "clipboard") return "Clipboard contents";
    if (v.kind === "date") return previewDate(v.value);
    return truncate(v.value, 60);
  }

  function kindLabel(kind: string): string {
    if (kind === "date") return "date & time";
    if (kind === "clipboard") return "clipboard";
    return "text";
  }

  return (
    <div className="flex h-screen flex-col">
      {/* ═══ Custom titlebar ═══ */}
      <header data-tauri-drag-region className="flex h-9 shrink-0 items-center justify-between bg-card pl-3 pr-1 ring-1 ring-foreground/5">
        <div className="flex items-center gap-2">
          <img src="/quill-icon.png" alt="Quill" className="size-4" />
          <span className="font-heading text-xs font-semibold">Quill</span>
        </div>
        <div className="flex items-center">
          {paused ? (
            <Button variant="outline" size="xs" onClick={togglePause} className="border-destructive text-destructive hover:bg-destructive/10">
              <span className="size-1.5 rounded-full bg-destructive" />
              Paused
            </Button>
          ) : (
            <Button variant="default" size="xs" onClick={togglePause}>
              <span className="size-1.5 rounded-full bg-primary-foreground" />
              Active
            </Button>
          )}
          <Button variant="ghost" size="icon-xs" onClick={() => setSettingsDlg(true)} title="Settings">
            <Settings />
          </Button>
          <div className="mx-0.5 h-3 w-px bg-border" />
          <Button variant="ghost" size="icon-xs" onClick={minimizeWindow} title="Minimize">
            <Minus />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={toggleMaximize} title={maximized ? "Restore" : "Maximize"}>
            {maximized ? <Copy /> : <Square />}
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={closeWindow} title="Close" className="hover:bg-destructive hover:text-destructive-foreground">
            <X />
          </Button>
        </div>
      </header>

      {/* ═══ Main content ═══ */}
      <div className="mx-auto flex max-w-3xl flex-1 flex-col overflow-hidden p-6">

        {/* Tabs */}
        <div className="flex shrink-0 items-center justify-between mb-4">
          <div className="flex gap-1">
            <Button variant={tab === 'snippets' ? 'default' : 'outline'} size="sm" onClick={() => setTab('snippets')}>Snippets</Button>
            <Button variant={tab === 'variables' ? 'default' : 'outline'} size="sm" onClick={() => setTab('variables')}>Variables</Button>
          </div>
          <Button size="sm" onClick={tab === 'snippets' ? openNewSnippet : openNewVariable}>
            <PlusIcon data-icon="start" />
            Add {tab === 'snippets' ? 'Snippet' : 'Variable'}
          </Button>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto min-h-0">
        {tab === 'snippets' ? (
          <Card>
            <CardContent>
              {snippets.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">No snippets yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Trigger</TableHead>
                      <TableHead>Expansion</TableHead>
                      <TableHead className="w-0 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {snippets.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-mono text-xs">{s.trigger}</TableCell>
                        <TableCell className="max-w-72 truncate text-muted-foreground">{truncate(s.expansion, 60)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="outline" size="xs" onClick={() => openEditSnippet(s)}>
                              <PencilIcon />Edit
                            </Button>
                            <Button variant="destructive" size="xs" onClick={() => requestDelete('snippet', s.id, s.trigger)}>
                              <Trash2Icon />Delete
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent>
              {variables.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">No variables yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead className="w-0 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {variables.map((v) => (
                      <TableRow key={v.id}>
                        <TableCell className="font-mono text-xs">{`{${v.name}}`}</TableCell>
                        <TableCell><Badge variant="secondary">{kindLabel(v.kind)}</Badge></TableCell>
                        <TableCell className="max-w-56 truncate text-muted-foreground">{varDisplay(v)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="outline" size="xs" onClick={() => openEditVariable(v)}>
                              <PencilIcon />Edit
                            </Button>
                            <Button variant="destructive" size="xs" onClick={() => requestDelete('variable', v.id, `{${v.name}}`)}>
                              <Trash2Icon />Delete
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
        </div>

      {/* ═══ Snippet dialog ═══ */}
      <Dialog open={snippetDlg} onOpenChange={setSnippetDlg}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={(e) => { e.preventDefault(); saveSnippet(); }}>
            <DialogHeader>
              <DialogTitle>{editingSnip ? "Edit Snippet" : "Add Snippet"}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="trigger" className="text-xs font-medium text-muted-foreground">Trigger</label>
                <Input id="trigger" value={trigger} onChange={(e) => setTrigger(e.target.value)} placeholder="e.g. ;addr" autoFocus />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="expansion" className="text-xs font-medium text-muted-foreground">Expansion</label>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="outline" size="xs" />}>
                      <PlusIcon data-icon="start" />
                      Insert Variable
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-56">
                      <DropdownMenuItem onClick={() => insertVariable('cursor')}>
                        <span className="font-mono text-xs">{`{cursor}`}</span>
                        <span className="truncate text-xs text-muted-foreground">Cursor position marker</span>
                      </DropdownMenuItem>
                      <div className="mx-2 my-1 h-px bg-border" />
                      <DropdownMenuGroup>
                        {variables.length === 0 && (
                          <div className="px-3 py-2 text-xs text-muted-foreground">No variables defined</div>
                        )}
                        {variables.map((v) => (
                          <DropdownMenuItem key={v.id} onClick={() => insertVariable(v.name)}>
                            <span className="font-mono text-xs">{`{${v.name}}`}</span>
                            <span className="truncate text-xs text-muted-foreground">{varDisplay(v)}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <Textarea id="expansion" ref={expansionRef} value={expansion} onChange={(e) => setExpansion(e.target.value)} placeholder="e.g. 123 Main St" rows={4} />
              </div>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} className="size-3.5 accent-primary" />
                  Whole word match only
                </label>
                <span className="text-xs text-muted-foreground">Use <code className="font-mono text-primary">{`{cursor}`}</code> to set cursor position</span>
              </div>
            </div>
            <DialogFooter>
              <Button type="submit">{editingSnip ? "Update" : "Add"}</Button>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ═══ Confirm delete dialog ═══ */}
      <Dialog open={confirmDlg} onOpenChange={(open) => { if (!open) { setConfirmDlg(false); setPendingDelete(null); } }}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Delete {pendingDelete?.type === 'snippet' ? 'snippet' : 'variable'}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete <strong>{pendingDelete?.label}</strong>? This cannot be undone.
          </p>
          <DialogFooter className="mt-2">
            <Button variant="destructive" onClick={confirmDelete}>Delete</Button>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Settings dialog ═══ */}
      <Dialog open={settingsDlg} onOpenChange={setSettingsDlg}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-5 py-4">

            {/* Theme */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Theme</label>
              <div className="flex gap-2">
                <Button variant={theme === 'system' ? 'default' : 'outline'} size="sm" onClick={() => setTheme('system')}>System</Button>
                <Button variant={theme === 'light' ? 'default' : 'outline'} size="sm" onClick={() => setTheme('light')}>Light</Button>
                <Button variant={theme === 'dark' ? 'default' : 'outline'} size="sm" onClick={() => setTheme('dark')}>Dark</Button>
              </div>
            </div>

            {/* Close to system tray */}
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-sm font-medium">Close to tray</span>
                <span className="text-xs text-muted-foreground">Minimize to tray instead of quitting</span>
              </div>
              <Button variant={closeToTray ? 'default' : 'outline'} size="sm" onClick={() => setCloseToTray(!closeToTray)}>
                {closeToTray ? 'On' : 'Off'}
              </Button>
            </div>

            {/* Run on boot */}
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-sm font-medium">Run on boot</span>
                <span className="text-xs text-muted-foreground">Auto-start Quill when you log in</span>
              </div>
              <Button variant={runOnBoot ? 'default' : 'outline'} size="sm" onClick={() => setRunOnBoot(!runOnBoot)}>
                {runOnBoot ? 'On' : 'Off'}
              </Button>
            </div>

            {/* Boot priority */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Boot priority</label>
              <div className="flex gap-2">
                <Button variant={bootPriority === 'low' ? 'default' : 'outline'} size="sm" onClick={() => setBootPriority('low')}>Low</Button>
                <Button variant={bootPriority === 'normal' ? 'default' : 'outline'} size="sm" onClick={() => setBootPriority('normal')}>Normal</Button>
                <Button variant={bootPriority === 'high' ? 'default' : 'outline'} size="sm" onClick={() => setBootPriority('high')}>High</Button>
              </div>
            </div>

            {/* Search hotkey */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Search popup hotkey</label>
              <div className="flex items-center gap-2">
                {recordingHotkey ? (
                  <div className="flex h-8 flex-1 items-center rounded-md border border-dashed px-3 text-xs text-muted-foreground">
                    Press a key combination…
                  </div>
                ) : (
                  <div className="flex h-8 flex-1 items-center rounded-md border bg-background px-3 font-mono text-xs">
                    {hotkey}
                  </div>
                )}
                <Button variant="outline" size="xs" onClick={startRecording} disabled={recordingHotkey}>
                  {recordingHotkey ? "…" : "Record"}
                </Button>
              </div>
            </div>

          </div>

          {/* About */}
          <div className="border-t pt-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Quill by <strong>Elixir-Piloting</strong></span>
              <a href="https://github.com/Elixir-Piloting" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
                GitHub <ExternalLink className="size-3" />
              </a>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">v0.1.0</span>
              <Button variant="outline" size="xs" onClick={checkForUpdates} disabled={updateState === 'checking'}>
                {updateState === 'checking' ? 'Checking...' : 'Check for Updates'}
              </Button>
            </div>
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Update dialog ═══ */}
      <Dialog open={updateDlg} onOpenChange={setUpdateDlg}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Update Available v{updateInfo?.version}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            {updateInfo?.body && (
              <div className="max-h-48 overflow-y-auto rounded-md bg-muted p-3 text-xs text-muted-foreground whitespace-pre-wrap">
                {updateInfo.body}
              </div>
            )}
            {!updateInfo?.body && (
              <p className="text-sm text-muted-foreground">A new version of Quill is available.</p>
            )}
          </div>
          <DialogFooter>
            {updateState === 'downloading' ? (
              <Button variant="default" size="sm" disabled>Downloading...</Button>
            ) : (
              <Button variant="default" size="sm" onClick={downloadAndInstall}>
                <Download /> Download &amp; Install
              </Button>
            )}
            <DialogClose render={<Button variant="outline" />}>Later</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Variable dialog ═══ */}
      <Dialog open={variableDlg} onOpenChange={setVariableDlg}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={(e) => { e.preventDefault(); saveVariable(); }}>
            <DialogHeader>
              <DialogTitle>{editingVar ? "Edit Variable" : "Add Variable"}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-4">
              <div className="flex gap-3">
                <div className="flex flex-1 flex-col gap-1.5">
                  <label htmlFor="var-name" className="text-xs font-medium text-muted-foreground">Name</label>
                  <Input id="var-name" value={varName} onChange={(e) => setVarName(e.target.value)} placeholder="e.g. signature" autoFocus />
                </div>
                <div className="flex w-40 flex-col gap-1.5">
                  <label htmlFor="var-kind" className="text-xs font-medium text-muted-foreground">Type</label>
                  <Select value={varKind} onValueChange={(v) => { if (v) setVarKind(v as VarKind); setVarDateFmt(""); setVarValue(""); }}>
                    <SelectTrigger id="var-kind">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="text">Text</SelectItem>
                        <SelectItem value="date">Date &amp; Time</SelectItem>
                        <SelectItem value="clipboard">Clipboard</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {varKind === "text" && (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="var-value" className="text-xs font-medium text-muted-foreground">Value</label>
                  <Textarea id="var-value" value={varValue} onChange={(e) => setVarValue(e.target.value)} placeholder="e.g. Best regards,\nJohn" rows={3} />
                </div>
              )}

              {varKind === "date" && (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="var-date-fmt" className="text-xs font-medium text-muted-foreground">Date format</label>
                  <Select value={varDateFmt} onValueChange={(v) => { if (v) setVarDateFmt(v); }}>
                    <SelectTrigger id="var-date-fmt">
                      <SelectValue placeholder="Select a format…" />
                    </SelectTrigger>
                    <SelectContent className="max-h-60">
                      <SelectGroup>
                        {DATE_FORMATS.map((f) => (
                          <SelectItem key={f.pattern} value={f.pattern}>{previewDate(f.pattern)}</SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {varDateFmt && (
                    <p className="text-xs text-muted-foreground">Preview: {previewDate(varDateFmt)}</p>
                  )}
                </div>
              )}

              {varKind === "clipboard" && (
                <p className="text-xs text-muted-foreground">This variable will be replaced by the current clipboard contents when expanded.</p>
              )}

              {varKind === "text" && varValue && (
                <p className="text-xs text-muted-foreground">Use the <strong>Insert Variable</strong> button in the snippet editor to add this variable.</p>
              )}
            </div>
            <DialogFooter>
              <Button type="submit">{editingVar ? "Update" : "Add"}</Button>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
    </div>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "\u2026";
}

export default App;
