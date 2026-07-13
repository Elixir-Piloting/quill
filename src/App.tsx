import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

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
  // Date only
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
  // Time only
  { label: "14:30",               pattern: "%H:%M" },
  { label: "2:30 PM",             pattern: "%I:%M %p" },
  { label: "14:30:00",            pattern: "%H:%M:%S" },
  { label: "2:30:00 PM",          pattern: "%I:%M:%S %p" },
  // Date + time
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
  const [insertOpen, setInsertOpen] = useState(false);

  // Variables
  const [variables, setVariables] = useState<Variable[]>([]);
  const [editingVar, setEditingVar] = useState<Variable | null>(null);
  const [varName, setVarName] = useState("");
  const [varKind, setVarKind] = useState<VarKind>("text");
  const [varValue, setVarValue] = useState("");
  const [varDateFmt, setVarDateFmt] = useState("");

  // ── Init ──

  useEffect(() => {
    loadSnippets();
    loadVariables();
    invoke<boolean>("get_paused").then(setPaused);
    const unlisten = listen<boolean>("paused-changed", (e) => setPaused(e.payload));
    return () => { unlisten.then((f) => f()); };
  }, []);

  // ── Snippets ──

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
    const before = expansion.slice(0, start);
    const after = expansion.slice(end);
    setExpansion(before + placeholder + after);
    setInsertOpen(false);
    // Restore focus and cursor position after React re-render
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + placeholder.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  // ── Variables ──

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

  // ── Pause ──

  async function togglePause() {
    setPaused(await invoke<boolean>("toggle_paused"));
  }

  // ── Render helpers ──

  function varDisplay(v: Variable): string {
    if (v.kind === "clipboard") return "Clipboard contents";
    if (v.kind === "date") return previewDate(v.value);
    return truncate(v.value, 50);
  }

  function kindLabel(kind: string): string {
    if (kind === "date") return "date & time";
    if (kind === "clipboard") return "clipboard";
    return "text";
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Quill</h1>
        <button className={`btn ${paused ? "btn-paused" : "btn-active"}`} onClick={togglePause}>
          {paused ? "Paused" : "Active"}
        </button>
      </header>

      {/* ══════ Snippet editor ══════ */}
      <section className="form-section">
        <h2>{editingSnip ? "Edit Snippet" : "Add Snippet"}</h2>
        <form onSubmit={(e) => { e.preventDefault(); saveSnippet(); }} className="snippet-form">
          <div className="field">
            <label htmlFor="trigger">Trigger</label>
            <input id="trigger" value={trigger} onChange={(e) => setTrigger(e.target.value)} placeholder="e.g. ;addr" autoFocus />
          </div>

          <div className="field">
            <div className="field-header">
              <label htmlFor="expansion">Expansion</label>
              <div className="insert-var-wrapper">
                <button type="button" className="btn btn-tiny" disabled={variables.length === 0} onClick={() => setInsertOpen(!insertOpen)}>
                  + Insert Variable
                </button>
                {insertOpen && (
                  <div className="insert-dropdown">
                    {variables.map((v) => (
                      <button key={v.id} type="button" className="insert-item" onClick={() => insertVariable(v.name)}>
                        <span className="insert-name">{`{${v.name}}`}</span>
                        <span className="insert-preview">{varDisplay(v)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <textarea id="expansion" ref={expansionRef} value={expansion} onChange={(e) => setExpansion(e.target.value)} placeholder="e.g. 123 Main St" rows={4} />
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary">{editingSnip ? "Update" : "Add"}</button>
            {editingSnip && <button type="button" className="btn btn-secondary" onClick={resetSnippetForm}>Cancel</button>}
          </div>
        </form>
      </section>

      {/* ══════ Snippet list ══════ */}
      <section className="list-section">
        <h2>Snippets</h2>
        {snippets.length === 0
          ? <p className="empty">No snippets yet.</p>
          : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Trigger</th>
                  <th>Expansion</th>
                  <th className="actions-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {snippets.map((s) => (
                  <tr key={s.id}>
                    <td className="cell-mono">{s.trigger}</td>
                    <td className="cell-truncate">{truncate(s.expansion, 60)}</td>
                    <td className="cell-actions">
                      <button className="btn btn-small" onClick={() => editSnippet(s)}>Edit</button>
                      <button className="btn btn-small btn-danger" onClick={() => deleteSnippet(s.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </section>

      {/* ══════ Variable editor ══════ */}
      <section className="form-section">
        <h2>{editingVar ? "Edit Variable" : "Add Variable"}</h2>
        <form onSubmit={(e) => { e.preventDefault(); saveVariable(); }} className="snippet-form">
          <div className="field-row">
            <div className="field">
              <label htmlFor="var-name">Name</label>
              <input id="var-name" value={varName} onChange={(e) => setVarName(e.target.value)} placeholder="e.g. signature" />
            </div>
            <div className="field field-kind">
              <label htmlFor="var-kind">Type</label>
              <select id="var-kind" value={varKind} onChange={(e) => { setVarKind(e.target.value as VarKind); setVarDateFmt(""); setVarValue(""); }}>
                <option value="text">Text</option>
                <option value="date">Date &amp; Time</option>
                <option value="clipboard">Clipboard</option>
              </select>
            </div>
          </div>

          {varKind === "text" && (
            <div className="field">
              <label htmlFor="var-value">Value</label>
              <textarea id="var-value" value={varValue} onChange={(e) => setVarValue(e.target.value)} placeholder="e.g. Best regards,\nJohn" rows={3} />
            </div>
          )}

          {varKind === "date" && (
            <div className="field">
              <label htmlFor="var-date-fmt">Date format</label>
              <select id="var-date-fmt" value={varDateFmt} onChange={(e) => setVarDateFmt(e.target.value)}>
                <option value="" disabled>Select a format…</option>
                {DATE_FORMATS.map((f) => (
                  <option key={f.pattern} value={f.pattern}>{previewDate(f.pattern)}</option>
                ))}
              </select>
            </div>
          )}

          {varKind === "clipboard" && (
            <p className="hint">This variable will be replaced by the current clipboard contents when expanded.</p>
          )}

          {varKind === "date" && varDateFmt && (
            <p className="hint">Preview: {previewDate(varDateFmt)}</p>
          )}

          {varKind === "text" && varValue && (
            <p className="hint">Insert this variable into a snippet using the <strong>+ Insert Variable</strong> button in the snippet editor.</p>
          )}

          <div className="form-actions">
            <button type="submit" className="btn btn-primary">{editingVar ? "Update" : "Add"}</button>
            {editingVar && <button type="button" className="btn btn-secondary" onClick={resetVarForm}>Cancel</button>}
          </div>
        </form>
      </section>

      {/* ══════ Variable list ══════ */}
      <section className="list-section">
        <h2>Variables</h2>
        {variables.length === 0
          ? <p className="empty">No variables yet.</p>
          : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Value</th>
                  <th className="actions-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {variables.map((v) => (
                  <tr key={v.id}>
                    <td className="cell-mono">{`{${v.name}}`}</td>
                    <td><span className={`badge badge-${v.kind}`}>{kindLabel(v.kind)}</span></td>
                    <td className="cell-truncate">{varDisplay(v)}</td>
                    <td className="cell-actions">
                      <button className="btn btn-small" onClick={() => editVariable(v)}>Edit</button>
                      <button className="btn btn-small btn-danger" onClick={() => deleteVariable(v.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </section>
    </div>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "\u2026";
}

export default App;
