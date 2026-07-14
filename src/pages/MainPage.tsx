import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
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
import { Search, PlusIcon, PencilIcon, Trash2Icon, XIcon, FolderIcon, FolderOpenIcon, CheckIcon } from "lucide-react";
import {
  Combobox,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipsInput,
} from "@/components/ui/combobox";

import type { Snippet, Variable, VarKind, Folder } from "../App";

interface RunningApp {
  name: string;
  exe: string;
}

interface FormInput {
  id: number;
  name: string;
  label: string;
  field_type: string;
  placeholder: string;
  default_value: string;
  required: boolean;
  folder_id: number | null;
  created_at: string;
}

const FIELD_TYPES: { value: string; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "email", label: "Email" },
  { value: "date", label: "Date" },
  { value: "textarea", label: "Textarea" },
];

const FIELD_TYPE_LABELS: Record<string, string> = Object.fromEntries(FIELD_TYPES.map((t) => [t.value, t.label]));

const FOLDER_COLORS = [
  "#bbd953", "#f97316", "#8b5cf6", "#06b6d4", "#ec4899",
  "#22c55e", "#eab308", "#64748b", "#a855f7", "#14b8a6",
];

interface Props {
  snippets: Snippet[];
  variables: Variable[];
  onRefreshSnippets: () => void;
  onRefreshVariables: () => void;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "\u2026" : s;
}

function previewDate(fmt: string): string {
  const d = new Date();
  const map: Record<string, string | (() => string)> = {
    "YYYY": String(d.getFullYear()),
    "YY": String(d.getFullYear()).slice(-2),
    "MM": String(d.getMonth() + 1).padStart(2, "0"),
    "M": String(d.getMonth() + 1),
    "DD": String(d.getDate()).padStart(2, "0"),
    "D": String(d.getDate()),
    "HH": String(d.getHours()).padStart(2, "0"),
    "H": String(d.getHours()),
    "mm": String(d.getMinutes()).padStart(2, "0"),
    "ss": String(d.getSeconds()).padStart(2, "0"),
    "AM/PM": () => (d.getHours() < 12 ? "AM" : "PM"),
  };
  let out = fmt;
  for (const [k, v] of Object.entries(map)) {
    const val = typeof v === "function" ? v() : v;
    out = out.replace(k, val);
  }
  return out;
}

export default function MainPage({ snippets, variables, onRefreshSnippets, onRefreshVariables }: Props) {
  const [tab, setTab] = useState<"snippets" | "variables" | "forms">("snippets");
  const [confirmDlg, setConfirmDlg] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ type: string; id: number; label: string } | null>(null);

  // ── Folders ──
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const uncategorizedFolderId = folders.find((f) => f.name === "Uncategorized")?.id ?? null;
  const [folderDlg, setFolderDlg] = useState(false);
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null);
  const [folderName, setFolderName] = useState("");
  const [folderColor, setFolderColor] = useState(FOLDER_COLORS[0]);
  const [folderError, setFolderError] = useState("");
  const [deleteFolderDlg, setDeleteFolderDlg] = useState(false);
  const [deletingFolder, setDeletingFolder] = useState<Folder | null>(null);

  async function loadFolders() {
    try { setFolders(await invoke<Folder[]>("get_folders")); } catch { setFolders([]); }
  }

  useEffect(() => { loadFolders(); }, []);

  function openNewFolder() {
    setEditingFolder(null);
    setFolderName("");
    setFolderColor(FOLDER_COLORS[0]);
    setFolderError("");
    setFolderDlg(true);
  }

  function openEditFolder(f: Folder) {
    setEditingFolder(f);
    setFolderName(f.name);
    setFolderColor(f.color);
    setFolderError("");
    setFolderDlg(true);
  }

  async function saveFolder() {
    const name = folderName.trim();
    if (!name) return;
    setFolderError("");
    try {
      if (editingFolder) {
        await invoke("update_folder", { id: editingFolder.id, name, color: folderColor });
      } else {
        await invoke("add_folder", { name, color: folderColor });
      }
      setFolderDlg(false);
      loadFolders();
    } catch (e) {
      setFolderError(String(e));
    }
  }

  function confirmDeleteFolder(f: Folder) {
    setDeletingFolder(f);
    setDeleteFolderDlg(true);
  }

  async function doDeleteFolder() {
    if (!deletingFolder) return;
    await invoke("delete_folder", { id: deletingFolder.id });
    if (selectedFolderId === deletingFolder.id) setSelectedFolderId(null);
    setDeleteFolderDlg(false);
    setDeletingFolder(null);
    loadFolders();
    onRefreshSnippets();
  }

  // ── Snippets ──

  const [snippetDlg, setSnippetDlg] = useState(false);
  const [editingSnip, setEditingSnip] = useState<Snippet | null>(null);
  const [trigger, setTrigger] = useState("");
  const [expansion, setExpansion] = useState("");
  const [wholeWord, setWholeWord] = useState(true);
  const [snippetFolderId, setSnippetFolderId] = useState<number | null>(null);
  const [appScope, setAppScope] = useState<RunningApp[]>([]);
  const [scopeEnabled, setScopeEnabled] = useState(false);
  const [runningApps, setRunningApps] = useState<RunningApp[]>([]);
  const expansionRef = useRef<HTMLTextAreaElement>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  function matchSearch(s: { trigger: string; expansion: string }) {
    return !debouncedSearch
      || s.trigger.toLowerCase().includes(debouncedSearch.toLowerCase())
      || s.expansion.toLowerCase().includes(debouncedSearch.toLowerCase());
  }

  const filteredSnippets = (selectedFolderId === null
    ? snippets
    : snippets.filter((s) => s.folder_id === selectedFolderId)).filter(matchSearch);

  function openNewSnippet() {
    setEditingSnip(null);
    setTrigger("");
    setExpansion("");
    setWholeWord(true);
    setSnippetFolderId(selectedFolderId ?? uncategorizedFolderId);
    setAppScope([]);
    setScopeEnabled(false);
    fetchRunningApps();
    setSnippetDlg(true);
  }

  function openEditSnippet(s: Snippet) {
    setEditingSnip(s);
    setTrigger(s.trigger);
    setExpansion(s.expansion);
    setWholeWord(s.whole_word);
    setSnippetFolderId(s.folder_id ?? uncategorizedFolderId);
    const scope: RunningApp[] = (() => {
      try { return JSON.parse(s.app_scope || "[]"); } catch { return []; }
    })();
    setAppScope(scope);
    setScopeEnabled(scope.length > 0);
    fetchRunningApps();
    setSnippetDlg(true);
    loadFormInputs();
  }

  async function fetchRunningApps() {
    try {
      const apps: RunningApp[] = await invoke("get_running_apps");
      setRunningApps(apps);
    } catch { setRunningApps([]); }
  }

  async function saveSnippet() {
    if (!trigger.trim() || !expansion.trim()) return;
    const appScopeStr = JSON.stringify(scopeEnabled ? appScope : []);
    try {
      if (editingSnip) {
        await invoke("update_snippet", { id: editingSnip.id, trigger: trigger.trim(), expansion: expansion.trim(), wholeWord, appScope: appScopeStr, folderId: snippetFolderId });
      } else {
        await invoke("add_snippet", { trigger: trigger.trim(), expansion: expansion.trim(), wholeWord, appScope: appScopeStr, folderId: snippetFolderId });
      }
      setSnippetDlg(false);
      onRefreshSnippets();
    } catch (e) {
      console.error(e);
    }
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

  const [variableDlg, setVariableDlg] = useState(false);
  const [editingVar, setEditingVar] = useState<Variable | null>(null);
  const [varName, setVarName] = useState("");
  const [varValue, setVarValue] = useState("");
  const [varKind, setVarKind] = useState<VarKind>("text");
  const [varFolderId, setVarFolderId] = useState<number | null>(null);

  function openNewVariable() {
    setEditingVar(null);
    setVarName("");
    setVarValue("");
    setVarKind("text");
    setVarFolderId(selectedFolderId ?? uncategorizedFolderId);
    setVariableDlg(true);
  }

  function openEditVariable(v: Variable) {
    setEditingVar(v);
    setVarName(v.name);
    setVarValue(v.value);
    setVarKind(v.kind as VarKind);
    setVarFolderId(v.folder_id);
    setVariableDlg(true);
  }

  async function saveVariable() {
    if (!varName.trim()) return;
    try {
      if (editingVar) {
        await invoke("update_variable", { id: editingVar.id, name: varName.trim(), value: varValue, kind: varKind, folderId: varFolderId });
      } else {
        await invoke("add_variable", { name: varName.trim(), value: varValue, kind: varKind, folderId: varFolderId });
      }
      setVariableDlg(false);
      onRefreshVariables();
    } catch (e) {
      console.error(e);
    }
  }

  // ── Form Inputs ──

  const [formInputs, setFormInputs] = useState<FormInput[]>([]);
  const filteredVariables = (selectedFolderId === null
    ? variables
    : variables.filter((v) => v.folder_id === selectedFolderId)).filter((v) => matchSearch({ trigger: v.name, expansion: v.value }));
  const filteredFormInputs = (selectedFolderId === null
    ? formInputs
    : formInputs.filter((f) => f.folder_id === selectedFolderId)).filter((f) => matchSearch({ trigger: f.name, expansion: f.label }));
  const [formDlg, setFormDlg] = useState(false);
  const [editingForm, setEditingForm] = useState<FormInput | null>(null);
  const [formName, setFormName] = useState("");
  const [formLabel, setFormLabel] = useState("");
  const [formFieldType, setFormFieldType] = useState("text");
  const [formPlaceholder, setFormPlaceholder] = useState("");
  const [formDefault, setFormDefault] = useState("");
  const [formRequired, setFormRequired] = useState(true);
  const [formFolderId, setFormFolderId] = useState<number | null>(null);

  async function loadFormInputs() {
    try { setFormInputs(await invoke<FormInput[]>("get_form_inputs")); } catch { setFormInputs([]); }
  }

  function openNewForm() {
    setEditingForm(null);
    setFormName("");
    setFormLabel("");
    setFormFieldType("text");
    setFormPlaceholder("");
    setFormDefault("");
    setFormRequired(true);
    setFormFolderId(selectedFolderId ?? uncategorizedFolderId);
    setFormDlg(true);
  }

  function openEditForm(f: FormInput) {
    setEditingForm(f);
    setFormName(f.name);
    setFormLabel(f.label);
    setFormFieldType(f.field_type);
    setFormPlaceholder(f.placeholder);
    setFormDefault(f.default_value);
    setFormRequired(f.required);
    setFormFolderId(f.folder_id);
    setFormDlg(true);
  }

  async function saveForm() {
    if (!formName.trim() || !formLabel.trim()) return;
    try {
      if (editingForm) {
        await invoke("update_form_input", { id: editingForm.id, name: formName.trim(), label: formLabel.trim(), fieldType: formFieldType, placeholder: formPlaceholder, defaultValue: formDefault, required: formRequired, folderId: formFolderId });
      } else {
        await invoke("add_form_input", { name: formName.trim(), label: formLabel.trim(), fieldType: formFieldType, placeholder: formPlaceholder, defaultValue: formDefault, required: formRequired, folderId: formFolderId });
      }
      setFormDlg(false);
      loadFormInputs();
    } catch (e) {
      console.error(e);
    }
  }

  function requestDeleteForm(id: number, label: string) {
    setPendingDelete({ type: "form", id, label });
    setConfirmDlg(true);
  }

  // ── Delete confirm ──

  function requestDelete(type: string, id: number, label: string) {
    setPendingDelete({ type, id, label });
    setConfirmDlg(true);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    if (pendingDelete.type === "snippet") {
      await invoke("delete_snippet", { id: pendingDelete.id });
      onRefreshSnippets();
    } else if (pendingDelete.type === "variable") {
      await invoke("delete_variable", { id: pendingDelete.id });
      onRefreshVariables();
    } else if (pendingDelete.type === "form") {
      await invoke("delete_form_input", { id: pendingDelete.id });
      loadFormInputs();
    }
    setConfirmDlg(false);
    setPendingDelete(null);
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
    <>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b bg-background px-6 py-3">
          <div className="flex items-center gap-2">
            <Button variant={tab === "snippets" ? "default" : "outline"} size="sm" onClick={() => setTab("snippets")}>Snippets</Button>
            <Button variant={tab === "variables" ? "default" : "outline"} size="sm" onClick={() => setTab("variables")}>Variables</Button>
            <Button variant={tab === "forms" ? "default" : "outline"} size="sm" onClick={() => { setTab("forms"); loadFormInputs(); }}>Form Inputs</Button>
          </div>
          <div className="relative mx-4 flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search trigger or expansion…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-7 pl-7 text-xs"
            />
          </div>
          <Button size="sm" onClick={
            tab === "snippets" ? openNewSnippet :
            tab === "variables" ? openNewVariable :
            openNewForm
          }>
            <PlusIcon data-icon="start" />
            Add {tab === "snippets" ? "Snippet" : tab === "variables" ? "Variable" : "Form Input"}
            {selectedFolderId !== null && folders.find((f) => f.id === selectedFolderId) &&
              ` to ${folders.find((f) => f.id === selectedFolderId)!.name}`}
          </Button>
        </div>

        <div className="flex flex-1 min-h-0 gap-4 overflow-hidden px-6 pb-4 pt-3">
          {/* Folder sidebar — shared across all tabs */}
          <div className="flex w-44 shrink-0 flex-col gap-1 overflow-y-auto">
            <button
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs transition-colors ${
                selectedFolderId === null ? "bg-primary/15 font-medium text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setSelectedFolderId(null)}
            >
              <FolderIcon className="size-3.5" />
              All {tab === "snippets" ? "Snippets" : tab === "variables" ? "Variables" : "Form Inputs"}
            </button>
            {folders.filter((f) => f.name !== "Uncategorized").map((f) => (
              <div key={f.id} className="group flex items-center gap-1">
                <button
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs transition-colors ${
                    selectedFolderId === f.id ? "bg-primary/15 font-medium text-primary" : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setSelectedFolderId(f.id)}
                >
                  {f.color ? <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: f.color }} /> : <FolderOpenIcon className="size-3.5" />}
                  <span className="truncate">{f.name}</span>
                </button>
                <div className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button className="flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted" onClick={(e) => { e.stopPropagation(); openEditFolder(f); }}>
                    <PencilIcon className="size-3" />
                  </button>
                  <button className="flex size-5 items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={(e) => { e.stopPropagation(); confirmDeleteFolder(f); }}>
                    <Trash2Icon className="size-3" />
                  </button>
                </div>
              </div>
            ))}
            {/* Uncategorized always shown last */}
            {folders.find((f) => f.name === "Uncategorized") && (() => {
              const uf = folders.find((f) => f.name === "Uncategorized")!;
              return (
                <button
                  className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs transition-colors ${
                    selectedFolderId === uf.id ? "bg-primary/15 font-medium text-primary" : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setSelectedFolderId(uf.id)}
                >
                  <XIcon className="size-3.5" />
                  Uncategorized
                </button>
              );
            })()}
            <div className="border-t pt-2 mt-1">
              <div className="flex gap-1">
                <Button variant="ghost" size="xs" className="w-full" onClick={openNewFolder}>
                  <PlusIcon className="size-3" /> New Folder
                </Button>
              </div>
            </div>
          </div>

          {/* Content area */}
          <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden rounded-xl">
            {tab === "snippets" ? (
              <div className="h-fit rounded-xl bg-card ring-1 ring-foreground/10">
                {filteredSnippets.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-muted-foreground">
                    {selectedFolderId === null ? "No snippets yet." : "This folder is empty."}
                  </p>
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
                      {filteredSnippets.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell className="font-mono text-xs">{s.trigger}</TableCell>
                          <TableCell className="max-w-72 truncate text-muted-foreground">{truncate(s.expansion, 60)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button variant="outline" size="icon-xs" onClick={() => openEditSnippet(s)}>
                                <PencilIcon />
                              </Button>
                              <Button variant="destructive" size="icon-xs" onClick={() => requestDelete("snippet", s.id, s.trigger)}>
                                <Trash2Icon />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            ) : tab === "variables" ? (
              <div className="h-fit rounded-xl bg-card ring-1 ring-foreground/10">
                {filteredVariables.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-muted-foreground">
                    {selectedFolderId === null ? "No variables yet." : "This folder is empty."}
                  </p>
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
                      {filteredVariables.map((v) => (
                        <TableRow key={v.id}>
                          <TableCell className="font-mono text-xs">{`{${v.name}}`}</TableCell>
                          <TableCell><Badge variant="secondary">{kindLabel(v.kind)}</Badge></TableCell>
                          <TableCell className="max-w-56 truncate text-muted-foreground">{varDisplay(v)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button variant="outline" size="icon-xs" onClick={() => openEditVariable(v)}>
                                <PencilIcon />
                              </Button>
                              <Button variant="destructive" size="icon-xs" onClick={() => requestDelete("variable", v.id, `{${v.name}}`)}>
                                <Trash2Icon />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            ) : (
              <div className="h-fit rounded-xl bg-card ring-1 ring-foreground/10">
                {filteredFormInputs.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-muted-foreground">
                    {selectedFolderId === null ? "No form inputs yet." : "This folder is empty."}
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Label</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Required</TableHead>
                        <TableHead className="w-0 text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredFormInputs.map((fi) => (
                        <TableRow key={fi.id}>
                          <TableCell className="font-mono text-xs">{`{${fi.name}}`}</TableCell>
                          <TableCell className="text-muted-foreground">{fi.label}</TableCell>
                          <TableCell><Badge variant="secondary">{FIELD_TYPE_LABELS[fi.field_type] || fi.field_type}</Badge></TableCell>
                          <TableCell>{fi.required ? <Badge>Yes</Badge> : <Badge variant="secondary">No</Badge>}</TableCell>
                          <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button variant="outline" size="icon-xs" onClick={() => openEditForm(fi)}>
                                  <PencilIcon />
                                </Button>
                                <Button variant="destructive" size="icon-xs" onClick={() => requestDeleteForm(fi.id, fi.label)}>
                                  <Trash2Icon />
                                </Button>
                              </div>
                            </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ Snippet dialog ═══ */}
      <Dialog open={snippetDlg} onOpenChange={setSnippetDlg}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={(e) => { e.preventDefault(); saveSnippet(); }}>
            <DialogHeader>
              <DialogTitle>{editingSnip ? "Edit Snippet" : "Add Snippet"}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-4">
              <div className="flex items-start gap-3">
                <div className="flex-1 flex flex-col gap-1.5">
                  <label htmlFor="trigger" className="text-xs font-medium text-muted-foreground">Trigger</label>
                  <Input id="trigger" value={trigger} onChange={(e) => setTrigger(e.target.value)} placeholder="e.g. ;addr" autoFocus />
                </div>
                <div className="w-44 flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Folder</label>
                <Select
                  defaultValue={String(snippetFolderId ?? uncategorizedFolderId ?? '')}
                  onValueChange={(v) => setSnippetFolderId(Number(v))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {(val) => {
                        const f = folders.find((ff) => String(ff.id) === val);
                        return f ? (
                          <span className="flex items-center gap-2">
                            {f.color && <span className="size-2 rounded-full" style={{ backgroundColor: f.color }} />}
                            {f.name}
                          </span>
                        ) : val;
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {folders.map((f) => (
                      <SelectItem key={f.id} value={String(f.id)}>
                        <span className="flex items-center gap-2">
                          {f.color && <span className="size-2 rounded-full" style={{ backgroundColor: f.color }} />}
                          {f.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                </div>
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
                      <DropdownMenuItem onClick={() => insertVariable("cursor")}>
                        <span className="font-mono text-xs">{`{cursor}`}</span>
                        <span className="truncate text-xs text-muted-foreground">Cursor position marker</span>
                      </DropdownMenuItem>
                      <div className="mx-2 my-1 h-px bg-border" />
                      <DropdownMenuGroup>
                        {variables.length === 0 && formInputs.length === 0 && (
                          <div className="px-3 py-2 text-xs text-muted-foreground">No variables or form inputs defined</div>
                        )}
                        {formInputs.map((f) => (
                          <DropdownMenuItem key={`form-${f.id}`} onClick={() => insertVariable(f.name)}>
                            <span className="font-mono text-xs">{`{${f.name}}`}</span>
                            <span className="truncate text-xs text-muted-foreground">{f.label}</span>
                          </DropdownMenuItem>
                        ))}
                        {formInputs.length > 0 && variables.length > 0 && (
                          <div className="mx-2 my-1 h-px bg-border" />
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
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={scopeEnabled} onChange={(e) => { setScopeEnabled(e.target.checked); if (!e.target.checked) setAppScope([]); }} className="size-3.5 accent-primary" />
                  Restrict to specific apps
                </label>
                {scopeEnabled && (
                  <Combobox
                    multiple
                    value={appScope.map((a) => a.exe)}
                    onValueChange={(v, _details) => {
                      const selected = v as string[];
                      setAppScope(selected.map((exe) => {
                        const found = runningApps.find((a) => a.exe === exe);
                        return found || { name: exe, exe };
                      }));
                    }}
                    itemToStringLabel={(exe) => {
                      const app = runningApps.find((a) => a.exe === exe);
                      return app?.name ?? exe;
                    }}
                  >
                    <ComboboxChips>
                      {appScope.map((a) => (
                        <ComboboxChip key={a.exe}>{a.name}</ComboboxChip>
                      ))}
                      <ComboboxChipsInput
                        placeholder="Search running apps..."
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.stopPropagation();
                        }}
                      />
                    </ComboboxChips>
                    <ComboboxContent>
                      <ComboboxEmpty>No matching apps</ComboboxEmpty>
                      <ComboboxList>
                        {runningApps
                          .filter((a) => !appScope.some((s) => s.exe === a.exe))
                          .map((a) => (
                            <ComboboxItem key={a.exe} value={a.exe}>
                              <CheckIcon className="size-3.5 opacity-0 data-selected:opacity-100" />
                              {a.name}
                            </ComboboxItem>
                          ))}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button type="submit">{editingSnip ? "Update" : "Add"}</Button>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ═══ Variable dialog ═══ */}
      <Dialog open={variableDlg} onOpenChange={setVariableDlg}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={(e) => { e.preventDefault(); saveVariable(); }}>
            <DialogHeader>
              <DialogTitle>{editingVar ? "Edit Variable" : "Add Variable"}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="varname" className="text-xs font-medium text-muted-foreground">Name</label>
                <Input id="varname" value={varName} onChange={(e) => setVarName(e.target.value)} placeholder="e.g. myName" autoFocus />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="varkind" className="text-xs font-medium text-muted-foreground">Type</label>
                <Select value={varKind} onValueChange={(v) => setVarKind(v as VarKind)}>
                  <SelectTrigger id="varkind">
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
              {varKind === "text" && (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="varval" className="text-xs font-medium text-muted-foreground">Value</label>
                  <Input id="varval" value={varValue} onChange={(e) => setVarValue(e.target.value)} placeholder="Your content here" />
                </div>
              )}
              {varKind === "date" && (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="datefmt" className="text-xs font-medium text-muted-foreground">Format</label>
                  <Input id="datefmt" value={varValue} onChange={(e) => setVarValue(e.target.value)} placeholder="e.g. YYYY-MM-DD" />
                  <span className="text-xs text-muted-foreground">Preview: {previewDate(varValue)}</span>
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Folder</label>
                <Select
                  defaultValue={String(varFolderId ?? uncategorizedFolderId ?? '')}
                  onValueChange={(v) => setVarFolderId(Number(v))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {(val) => {
                        const f = folders.find((ff) => String(ff.id) === val);
                        return f ? (
                          <span className="flex items-center gap-2">
                            {f.color && <span className="size-2 rounded-full" style={{ backgroundColor: f.color }} />}
                            {f.name}
                          </span>
                        ) : val;
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {folders.map((f) => (
                      <SelectItem key={f.id} value={String(f.id)}>
                        <span className="flex items-center gap-2">
                          {f.color && <span className="size-2 rounded-full" style={{ backgroundColor: f.color }} />}
                          {f.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="submit">{editingVar ? "Update" : "Add"}</Button>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ═══ Form dialog ═══ */}
      <Dialog open={formDlg} onOpenChange={setFormDlg}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={(e) => { e.preventDefault(); saveForm(); }}>
            <DialogHeader>
              <DialogTitle>{editingForm ? "Edit Form Input" : "Add Form Input"}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Name (used as <code className="font-mono">{`{name}`}</code>)</label>
                <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. fullName" autoFocus />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Label</label>
                <Input value={formLabel} onChange={(e) => setFormLabel(e.target.value)} placeholder="e.g. Full Name" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Field Type</label>
                <Select value={formFieldType} onValueChange={(v) => v && setFormFieldType(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIELD_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Placeholder</label>
                <Input value={formPlaceholder} onChange={(e) => setFormPlaceholder(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Default Value</label>
                <Input value={formDefault} onChange={(e) => setFormDefault(e.target.value)} />
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={formRequired} onChange={(e) => setFormRequired(e.target.checked)} className="size-3.5 accent-primary" />
                Required
              </label>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Folder</label>
                <Select
                  defaultValue={String(formFolderId ?? uncategorizedFolderId ?? '')}
                  onValueChange={(v) => setFormFolderId(Number(v))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {(val) => {
                        const f = folders.find((ff) => String(ff.id) === val);
                        return f ? (
                          <span className="flex items-center gap-2">
                            {f.color && <span className="size-2 rounded-full" style={{ backgroundColor: f.color }} />}
                            {f.name}
                          </span>
                        ) : val;
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {folders.map((f) => (
                      <SelectItem key={f.id} value={String(f.id)}>
                        <span className="flex items-center gap-2">
                          {f.color && <span className="size-2 rounded-full" style={{ backgroundColor: f.color }} />}
                          {f.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="submit">{editingForm ? "Update" : "Add"}</Button>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ═══ Delete confirm dialog ═══ */}
      <Dialog open={confirmDlg} onOpenChange={setConfirmDlg}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Delete {pendingDelete?.type === "snippet" ? "Snippet" : pendingDelete?.type === "variable" ? "Variable" : "Form Input"}?</DialogTitle>
          </DialogHeader>
          <p className="py-2 text-sm text-muted-foreground">
            Are you sure you want to delete <span className="font-medium text-foreground">{pendingDelete?.label}</span>? This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="destructive" onClick={confirmDelete}>Delete</Button>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Folder dialog ═══ */}
      <Dialog open={folderDlg} onOpenChange={setFolderDlg}>
        <DialogContent className="sm:max-w-xs">
          <form onSubmit={(e) => { e.preventDefault(); saveFolder(); }}>
            <DialogHeader>
              <DialogTitle>{editingFolder ? "Rename Folder" : "New Folder"}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Name</label>
                <Input value={folderName} onChange={(e) => setFolderName(e.target.value)} placeholder="e.g. Personal" autoFocus />
                {folderError && <span className="text-xs text-destructive">{folderError}</span>}
              </div>
              {!editingFolder && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Color</label>
                  <div className="flex flex-wrap gap-2">
                    {FOLDER_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={`size-6 rounded-full ring-offset-2 ring-offset-background transition-shadow ${
                          folderColor === c ? "ring-2 ring-foreground" : ""
                        }`}
                        style={{ backgroundColor: c }}
                        onClick={() => setFolderColor(c)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button type="submit">{editingFolder ? "Rename" : "Create"}</Button>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ═══ Delete folder confirm dialog ═══ */}
      <Dialog open={deleteFolderDlg} onOpenChange={setDeleteFolderDlg}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Delete "{deletingFolder?.name}"?</DialogTitle>
          </DialogHeader>
          <p className="py-2 text-sm text-muted-foreground">
            Items in this folder will be moved to Uncategorized. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="destructive" onClick={doDeleteFolder}>Delete Folder</Button>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
