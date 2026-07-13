import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { PlusIcon } from "lucide-react";

// ── Types ──

interface Snippet {
  id: number;
  trigger: string;
  expansion: string;
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

  // Snippets
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [editingSnip, setEditingSnip] = useState<Snippet | null>(null);
  const [trigger, setTrigger] = useState("");
  const [expansion, setExpansion] = useState("");
  const expansionRef = useRef<HTMLTextAreaElement>(null);

  // Variables
  const [variables, setVariables] = useState<Variable[]>([]);
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
    const unlisten = listen<boolean>("paused-changed", (e) => setPaused(e.payload));
    return () => { unlisten.then((f) => f()); };
  }, []);

  // Snippets
  async function loadSnippets() {
    setSnippets(await invoke<Snippet[]>("get_snippets"));
  }

  function resetSnippetForm() {
    setEditingSnip(null);
    setTrigger("");
    setExpansion("");
  }

  async function saveSnippet() {
    if (!trigger.trim() || !expansion.trim()) return;
    if (editingSnip) {
      await invoke("update_snippet", { id: editingSnip.id, trigger: trigger.trim(), expansion: expansion.trim() });
    } else {
      await invoke("add_snippet", { trigger: trigger.trim(), expansion: expansion.trim() });
    }
    resetSnippetForm();
    loadSnippets();
  }

  function editSnippet(s: Snippet) {
    setEditingSnip(s);
    setTrigger(s.trigger);
    setExpansion(s.expansion);
  }

  async function deleteSnippet(id: number) {
    await invoke("delete_snippet", { id });
    loadSnippets();
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

  // Variables
  async function loadVariables() {
    setVariables(await invoke<Variable[]>("get_variables"));
  }

  function resetVarForm() {
    setEditingVar(null);
    setVarName("");
    setVarKind("text");
    setVarValue("");
    setVarDateFmt("");
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
    resetVarForm();
    loadVariables();
  }

  function editVariable(v: Variable) {
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
  }

  async function deleteVariable(id: number) {
    await invoke("delete_variable", { id });
    loadVariables();
  }

  // Pause
  async function togglePause() {
    setPaused(await invoke<boolean>("toggle_paused"));
  }

  // Helpers
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
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      {/* ═══ Header ═══ */}
      <header className="flex items-center justify-between">
        <h1 className="font-heading text-xl font-semibold">Quill</h1>
        <Button variant={paused ? "secondary" : "default"} onClick={togglePause}>
          {paused ? "Paused" : "Active"}
        </Button>
      </header>

      {/* ═══ Snippet editor ═══ */}
      <Card>
        <CardHeader>
          <CardTitle>{editingSnip ? "Edit Snippet" : "Add Snippet"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => { e.preventDefault(); saveSnippet(); }} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="trigger" className="text-xs font-medium text-muted-foreground">Trigger</label>
              <Input id="trigger" value={trigger} onChange={(e) => setTrigger(e.target.value)} placeholder="e.g. ;addr" autoFocus />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="expansion" className="text-xs font-medium text-muted-foreground">Expansion</label>
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="outline" size="xs" />}>
                    <PlusIcon data-icon="inline-start" />
                    Insert Variable
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-56">
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
            <div className="flex gap-2">
              <Button type="submit">{editingSnip ? "Update" : "Add"}</Button>
              {editingSnip && <Button type="button" variant="outline" onClick={resetSnippetForm}>Cancel</Button>}
            </div>
          </form>
        </CardContent>
      </Card>

      {/* ═══ Snippet list ═══ */}
      <Card>
        <CardHeader>
          <CardTitle>Snippets</CardTitle>
        </CardHeader>
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
                        <Button variant="outline" size="xs" onClick={() => editSnippet(s)}>Edit</Button>
                        <Button variant="destructive" size="xs" onClick={() => deleteSnippet(s.id)}>Delete</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ═══ Variable editor ═══ */}
      <Card>
        <CardHeader>
          <CardTitle>{editingVar ? "Edit Variable" : "Add Variable"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => { e.preventDefault(); saveVariable(); }} className="flex flex-col gap-4">
            <div className="flex gap-3">
              <div className="flex flex-1 flex-col gap-1.5">
                <label htmlFor="var-name" className="text-xs font-medium text-muted-foreground">Name</label>
                <Input id="var-name" value={varName} onChange={(e) => setVarName(e.target.value)} placeholder="e.g. signature" />
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
                  <SelectContent>
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

            <div className="flex gap-2">
              <Button type="submit">{editingVar ? "Update" : "Add"}</Button>
              {editingVar && <Button type="button" variant="outline" onClick={resetVarForm}>Cancel</Button>}
            </div>
          </form>
        </CardContent>
      </Card>

      {/* ═══ Variable list ═══ */}
      <Card>
        <CardHeader>
          <CardTitle>Variables</CardTitle>
        </CardHeader>
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
                        <Button variant="outline" size="xs" onClick={() => editVariable(v)}>Edit</Button>
                        <Button variant="destructive" size="xs" onClick={() => deleteVariable(v.id)}>Delete</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "\u2026";
}

export default App;
