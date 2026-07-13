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
import { Card, CardContent } from "@/components/ui/card";
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
import { PlusIcon, PencilIcon, Trash2Icon, XIcon, SearchIcon } from "lucide-react";

import type { Snippet, Variable, VarKind } from "../App";

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
  created_at: string;
}

const FIELD_TYPE_LABELS: Record<string, string> = {
  text: "Text",
  date: "Date",
  number: "Number",
  email: "Email",
  textarea: "Textarea",
};

function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

// ── Date format helpers ──

interface DateFormatOption { label: string; pattern: string; }

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

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "\u2026";
}

// ── Props ──

interface Props {
  snippets: Snippet[];
  variables: Variable[];
  onRefreshSnippets: () => void;
  onRefreshVariables: () => void;
}

// ── Main page ──

function MainPage({ snippets, variables, onRefreshSnippets, onRefreshVariables }: Props) {
  const [tab, setTab] = useState<"snippets" | "variables" | "forms">("snippets");
  const [formInputs, setFormInputs] = useState<FormInput[]>([]);

  // Snippet dialog
  const [snippetDlg, setSnippetDlg] = useState(false);
  const [editingSnip, setEditingSnip] = useState<Snippet | null>(null);
  const [trigger, setTrigger] = useState("");
  const [expansion, setExpansion] = useState("");
  const [wholeWord, setWholeWord] = useState(true);
  const [appScope, setAppScope] = useState<RunningApp[]>([]);
  const [scopeEnabled, setScopeEnabled] = useState(false);
  const [runningApps, setRunningApps] = useState<RunningApp[]>([]);
  const [appSearch, setAppSearch] = useState("");
  const expansionRef = useRef<HTMLTextAreaElement>(null);

  // Form input dialog
  const [formDlg, setFormDlg] = useState(false);
  const [editingForm, setEditingForm] = useState<FormInput | null>(null);
  const [formName, setFormName] = useState("");
  const [formLabel, setFormLabel] = useState("");
  const [formFieldType, setFormFieldType] = useState("text");
  const [formPlaceholder, setFormPlaceholder] = useState("");
  const [formDefault, setFormDefault] = useState("");
  const [formRequired, setFormRequired] = useState(true);
  const formNameTouched = useRef(false);

  const FORM_FIELD_TYPES = [
    { value: "text", label: "Text" },
    { value: "date", label: "Date" },
    { value: "number", label: "Number" },
    { value: "email", label: "Email" },
    { value: "textarea", label: "Textarea" },
  ];

  // Variable dialog
  const [variableDlg, setVariableDlg] = useState(false);
  const [editingVar, setEditingVar] = useState<Variable | null>(null);
  const [varName, setVarName] = useState("");
  const [varKind, setVarKind] = useState<VarKind>("text");
  const [varValue, setVarValue] = useState("");
  const [varDateFmt, setVarDateFmt] = useState("");

  // Confirm dialog
  const [confirmDlg, setConfirmDlg] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ type: "snippet" | "variable" | "form"; id: number; label: string } | null>(null);

  // ── Load form inputs on mount for snippet editor dropdown ──

  useEffect(() => { loadFormInputs(); }, []);

  async function loadFormInputs() {
    try {
      const fi = await invoke<FormInput[]>("get_form_inputs");
      setFormInputs(fi);
    } catch {
      setFormInputs([]);
    }
  }

  // ── Snippet CRUD ──

  function openNewSnippet() {
    setEditingSnip(null);
    setTrigger("");
    setExpansion("");
    setWholeWord(true);
    setAppScope([]);
    setScopeEnabled(false);
    setAppSearch("");
    fetchRunningApps();
    setSnippetDlg(true);
  }

  function openEditSnippet(s: Snippet) {
    setEditingSnip(s);
    setTrigger(s.trigger);
    setExpansion(s.expansion);
    setWholeWord(s.whole_word);
    const scope: RunningApp[] = (() => {
      try { return JSON.parse(s.app_scope || "[]"); } catch { return []; }
    })();
    setAppScope(scope);
    setScopeEnabled(scope.length > 0);
    setAppSearch("");
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
    if (editingSnip) {
      await invoke("update_snippet", { id: editingSnip.id, trigger: trigger.trim(), expansion: expansion.trim(), wholeWord, appScope: appScopeStr });
    } else {
      await invoke("add_snippet", { trigger: trigger.trim(), expansion: expansion.trim(), wholeWord, appScope: appScopeStr });
    }
    setSnippetDlg(false);
    onRefreshSnippets();
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

  // ── Form Input CRUD ──

  function openNewForm() {
    setEditingForm(null);
    setFormName("");
    setFormLabel("");
    setFormFieldType("text");
    setFormPlaceholder("");
    setFormDefault("");
    setFormRequired(true);
    formNameTouched.current = false;
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
    setFormDlg(true);
  }

  async function saveForm() {
    if (!formName.trim()) return;
    const payload = {
      name: formName.trim(),
      label: formLabel.trim() || formName.trim(),
      fieldType: formFieldType,
      placeholder: formPlaceholder.trim(),
      defaultValue: formDefault.trim(),
      required: formRequired,
    };
    if (editingForm) {
      await invoke("update_form_input", { id: editingForm.id, ...payload });
    } else {
      await invoke("add_form_input", payload);
    }
    setFormDlg(false);
    loadFormInputs();
  }

  function requestDeleteForm(id: number, label: string) {
    setPendingDelete({ type: "form", id, label });
    setConfirmDlg(true);
  }

  // ── Variable CRUD ──

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
    onRefreshVariables();
  }

  // ── Delete ──

  function requestDelete(type: "snippet" | "variable", id: number, label: string) {
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
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
          <div className="flex shrink-0 items-center justify-between">
            <div className="flex gap-1">
              <Button variant={tab === "snippets" ? "default" : "outline"} size="sm" onClick={() => setTab("snippets")}>Snippets</Button>
              <Button variant={tab === "variables" ? "default" : "outline"} size="sm" onClick={() => setTab("variables")}>Variables</Button>
              <Button variant={tab === "forms" ? "default" : "outline"} size="sm" onClick={() => { setTab("forms"); loadFormInputs(); }}>Form Inputs</Button>
            </div>
            <Button size="sm" onClick={
              tab === "snippets" ? openNewSnippet :
              tab === "variables" ? openNewVariable :
              openNewForm
            }>
              <PlusIcon data-icon="start" />
              Add {tab === "snippets" ? "Snippet" : tab === "variables" ? "Variable" : "Form Input"}
            </Button>
          </div>
          {tab === "snippets" ? (
            <Card className="h-fit">
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
                              <Button variant="destructive" size="xs" onClick={() => requestDelete("snippet", s.id, s.trigger)}>
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
          ) : tab === "variables" ? (
            <Card className="h-fit">
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
                              <Button variant="destructive" size="xs" onClick={() => requestDelete("variable", v.id, `{${v.name}}`)}>
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
            <Card className="h-fit">
              <CardContent>
                {formInputs.length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">No form inputs yet.</p>
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
                      {formInputs.map((f) => (
                        <TableRow key={f.id}>
                          <TableCell className="font-mono text-xs">{`{${f.name}}`}</TableCell>
                          <TableCell className="text-muted-foreground">{f.label}</TableCell>
                          <TableCell><Badge variant="secondary">{FIELD_TYPE_LABELS[f.field_type] || f.field_type}</Badge></TableCell>
                          <TableCell>{f.required ? <Badge>Yes</Badge> : <Badge variant="secondary">No</Badge>}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button variant="outline" size="xs" onClick={() => openEditForm(f)}>
                                <PencilIcon />Edit
                              </Button>
                              <Button variant="destructive" size="xs" onClick={() => requestDeleteForm(f.id, f.label)}>
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
                  <input type="checkbox" checked={scopeEnabled} onChange={(e) => { setScopeEnabled(e.target.checked); if (!e.target.checked) setAppSearch(""); }} className="size-3.5 accent-primary" />
                  Restrict to specific apps
                </label>
                {scopeEnabled && (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex flex-wrap gap-1.5">
                      {appScope.map((a) => (
                        <span key={a.exe} className="inline-flex items-center gap-1 rounded bg-primary/15 px-2 py-0.5 text-xs">
                          {a.name}
                          <button type="button" onClick={() => setAppScope(appScope.filter((x) => x.exe !== a.exe))} className="hover:text-destructive">
                            <XIcon className="size-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="relative">
                      <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="text"
                        value={appSearch}
                        onChange={(e) => setAppSearch(e.target.value)}
                        placeholder="Search running apps..."
                        className="w-full rounded-md border border-input bg-background py-1.5 pl-7 pr-2 text-xs outline-none focus:border-primary"
                      />
                    </div>
                    <div className="max-h-36 overflow-y-auto rounded-md border border-input">
                      {runningApps
                        .filter((a) => a.name.toLowerCase().includes(appSearch.toLowerCase()) && !appScope.some((s) => s.exe === a.exe))
                        .slice(0, 20)
                        .map((a) => (
                          <button
                            key={a.exe}
                            type="button"
                            onClick={() => { setAppScope([...appScope, a]); setAppSearch(""); }}
                            className="w-full px-2 py-1 text-left text-xs hover:bg-accent"
                          >
                            {a.name}
                          </button>
                        ))}
                      {runningApps.filter((a) => a.name.toLowerCase().includes(appSearch.toLowerCase()) && !appScope.some((s) => s.exe === a.exe)).length === 0 && (
                        <div className="px-2 py-1 text-xs text-muted-foreground">No matching apps</div>
                      )}
                    </div>
                  </div>
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

      {/* ═══ Form Input dialog ═══ */}
      <Dialog open={formDlg} onOpenChange={setFormDlg}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={(e) => { e.preventDefault(); saveForm(); }}>
            <DialogHeader>
              <DialogTitle>{editingForm ? "Edit Form Input" : "Add Form Input"}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="form-label" className="text-xs font-medium text-muted-foreground">Label</label>
                <Input
                  id="form-label"
                  value={formLabel}
                  onChange={(e) => { setFormLabel(e.target.value); if (!editingForm && !formNameTouched.current) setFormName(slug(e.target.value)); }}
                  placeholder="e.g. Client name?"
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="form-name" className="text-xs font-medium text-muted-foreground">Variable name</label>
                <Input id="form-name" value={formName} onChange={(e) => { formNameTouched.current = true; setFormName(e.target.value); }} placeholder="auto-generated from label" />
                <span className="text-xs text-muted-foreground">Use <code className="font-mono text-primary">{`{${formName || 'name'}}`}</code> in snippet expansion</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="form-field-type" className="text-xs font-medium text-muted-foreground">Type</label>
                <Select value={formFieldType} onValueChange={(v) => { if (v) setFormFieldType(v); }}>
                  <SelectTrigger id="form-field-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {FORM_FIELD_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              {formFieldType !== "textarea" && (
              <div className="flex gap-2">
                <div className="flex flex-1 flex-col gap-1.5">
                  <label htmlFor="form-placeholder" className="text-xs font-medium text-muted-foreground">Placeholder (optional)</label>
                  <Input id="form-placeholder" value={formPlaceholder} onChange={(e) => setFormPlaceholder(e.target.value)} placeholder={formFieldType === "date" ? "e.g. Select a date" : "e.g. John Doe"} />
                </div>
                <div className="flex flex-1 flex-col gap-1.5">
                  <label htmlFor="form-default" className="text-xs font-medium text-muted-foreground">Default value (optional)</label>
                  <Input id="form-default" value={formDefault} onChange={(e) => setFormDefault(e.target.value)} placeholder={formFieldType === "date" ? "e.g. 2026-07-13" : "e.g. John"} />
                </div>
              </div>
              )}
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={formRequired} onChange={(e) => setFormRequired(e.target.checked)} className="size-3.5 accent-primary" />
                Required
              </label>
            </div>
            <DialogFooter>
              <Button type="submit">{editingForm ? "Update" : "Add"}</Button>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            </DialogFooter>
          </form>
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
                  <Select value={varKind} onValueChange={(v) => { if (v) { setVarKind(v as VarKind); setVarDateFmt(""); setVarValue(""); } }}>
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
                  {varDateFmt && <p className="text-xs text-muted-foreground">Preview: {previewDate(varDateFmt)}</p>}
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

      {/* ═══ Confirm delete dialog ═══ */}
      <Dialog open={confirmDlg} onOpenChange={(open) => { if (!open) { setConfirmDlg(false); setPendingDelete(null); } }}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Delete {pendingDelete?.type === "snippet" ? "snippet" : pendingDelete?.type === "form" ? "form input" : "variable"}?</DialogTitle>
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
    </>
  );
}

export default MainPage;
