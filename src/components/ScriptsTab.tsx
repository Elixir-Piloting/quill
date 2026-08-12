import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
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
import { Play, PencilIcon, Trash2Icon, ChevronDown, ChevronRight, Loader2, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import type { Variable, Folder } from "../App";

export interface ScriptsTabHandle {
  openNew: () => void;
}

interface Props {
  ref?: React.Ref<ScriptsTabHandle>;
  scripts: Variable[];
  folders: Folder[];
  selectedFolderId: number | null;
  uncategorizedFolderId: number | null;
  onRefresh: () => void;
  onRequestDelete: (id: number, label: string) => void;
}

type ShellKind = "powershell" | "cmd" | "wsl" | "custom";

interface ScriptConfig {
  description?: string;
  source:
    | { source: "inline"; command: string }
    | { source: "file"; interpreter: string; path: string; extra_args: string[] };
  shell:
    | { shell: "powershell" }
    | { shell: "cmd" }
    | { shell: "wsl" }
    | { shell: "custom"; executable: string; arg_flag: string };
  timeout_ms: number;
  trim_output: boolean;
}

const SHELL_LABELS: Record<ShellKind, string> = {
  powershell: "PowerShell",
  cmd: "Command Prompt",
  wsl: "WSL Bash",
  custom: "Custom",
};

const MIN_TIMEOUT = 500;
const MAX_TIMEOUT = 30000;

function parseConfig(value: string): ScriptConfig {
    try {
    const c = JSON.parse(value);
    const source = c.source ?? { source: "inline", command: "" };
    const shell = c.shell ?? { shell: "powershell" };
    return {
      description: typeof c.description === "string" ? c.description : undefined,
      source,
      shell,
      timeout_ms: typeof c.timeout_ms === "number" ? c.timeout_ms : 5000,
      trim_output: typeof c.trim_output === "boolean" ? c.trim_output : true,
    };
  } catch {
    return {
      source: { source: "inline", command: value },
      shell: { shell: "powershell" },
      timeout_ms: 5000,
      trim_output: true,
    };
  }
}

/** Label with an optional info-hover tooltip explaining the field. */
function FieldLabel({
  htmlFor,
  hint,
  children,
}: {
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  if (!hint) {
    return (
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {children}
      </label>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {children}
      </label>
      <Tooltip>
        <TooltipTrigger
          render={<span className="inline-flex cursor-help items-center" tabIndex={0} />}
        >
          <Info className="size-3.5 text-muted-foreground/60" />
        </TooltipTrigger>
        <TooltipContent>{hint}</TooltipContent>
      </Tooltip>
    </span>
  );
}

function ScriptsTab({ scripts, folders, selectedFolderId, uncategorizedFolderId, onRefresh, onRequestDelete, ref }: Props) {
  const [wslAvailable, setWslAvailable] = useState<boolean | null>(null);

  const [dlg, setDlg] = useState(false);
  const [editing, setEditing] = useState<Variable | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sourceMode, setSourceMode] = useState<"inline" | "file">("inline");
  const [command, setCommand] = useState("");
  const [interpreter, setInterpreter] = useState("");
  const [filePath, setFilePath] = useState("");
  const [extraArgs, setExtraArgs] = useState("");
  const [shell, setShell] = useState<ShellKind>("powershell");
  const [customExe, setCustomExe] = useState("");
  const [customArgFlag, setCustomArgFlag] = useState("-c");
  const [timeoutMs, setTimeoutMs] = useState("5000");
  const [trimOutput, setTrimOutput] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [folderId, setFolderId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const [testState, setTestState] = useState<"idle" | "running">("idle");
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const commandRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    invoke<boolean>("get_wsl_available")
      .then(setWslAvailable)
      .catch(() => setWslAvailable(false));
  }, []);

  useImperativeHandle(ref, () => ({ openNew }), [selectedFolderId, uncategorizedFolderId]);

  function openNew() {
    setEditing(null);
    setName("");
    setDescription("");
    setSourceMode("inline");
    setCommand("");
    setInterpreter("");
    setFilePath("");
    setExtraArgs("");
    setShell("powershell");
    setCustomExe("");
    setCustomArgFlag("-c");
    setTimeoutMs("5000");
    setTrimOutput(true);
    setShowAdvanced(false);
    setFolderId(selectedFolderId ?? uncategorizedFolderId);
    setError("");
    setTestResult(null);
    setTestState("idle");
    setDlg(true);
  }

  function openEdit(v: Variable) {
    const c = parseConfig(v.value);
    const src = c.source.source === "inline"
      ? { mode: "inline" as const, command: c.source.command, interpreter: "", filePath: "", extraArgs: "" }
      : { mode: "file" as const, command: "", interpreter: c.source.interpreter, filePath: c.source.path, extraArgs: c.source.extra_args.join(" ") };
    setEditing(v);
    setName(v.name);
    setDescription(c.description ?? "");
    setSourceMode(src.mode);
    setCommand(src.command);
    setInterpreter(src.interpreter);
    setFilePath(src.filePath);
    setExtraArgs(src.extraArgs);
    const sh = c.shell.shell as ShellKind;
    setShell(sh);
    setCustomExe(c.shell.shell === "custom" ? c.shell.executable : "");
    setCustomArgFlag(c.shell.shell === "custom" ? c.shell.arg_flag : "-c");
    setTimeoutMs(String(c.timeout_ms));
    setTrimOutput(c.trim_output);
    setShowAdvanced(false);
    setFolderId(v.folder_id);
    setError("");
    setTestResult(null);
    setTestState("idle");
    setDlg(true);
  }

  async function pickFile() {
    try {
      const res = await open({ multiple: false });
      if (typeof res === "string") setFilePath(res);
    } catch {
      // user cancelled
    }
  }

  function buildConfig(): ScriptConfig {
    const src = sourceMode === "inline"
      ? { source: "inline" as const, command }
      : {
          source: "file" as const,
          interpreter,
          path: filePath,
          extra_args: extraArgs.split(/\s+/).filter(Boolean),
        };
    const sh = shell === "custom"
      ? { shell: "custom" as const, executable: customExe, arg_flag: customArgFlag }
      : ({ shell } as { shell: "powershell" | "cmd" | "wsl" });
    return {
      description: description.trim() ? description.trim() : undefined,
      source: src,
      shell: sh,
      timeout_ms: clampTimeout(parseInt(timeoutMs, 10)),
      trim_output: trimOutput,
    };
  }

  function clampTimeout(v: number): number {
    if (Number.isNaN(v)) return 5000;
    return Math.max(MIN_TIMEOUT, Math.min(MAX_TIMEOUT, v));
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required");
      return;
    }
    setError("");
    try {
      const value = JSON.stringify(buildConfig());
      if (editing) {
        await invoke("update_variable", { id: editing.id, name: trimmed, value, kind: "script", folderId });
      } else {
        await invoke("add_variable", { name: trimmed, value, kind: "script", folderId });
      }
      setDlg(false);
      onRefresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function testRun() {
    setTestState("running");
    setTestResult(null);
    try {
      const out = await invoke<string>("run_script_test", { config: buildConfig() });
      setTestResult({ ok: true, text: out });
    } catch (e) {
      setTestResult({ ok: false, text: String(e) });
    } finally {
      setTestState("idle");
    }
  }

  function scriptSourceLabel(v: Variable): string {
    const c = parseConfig(v.value);
    return c.source.source === "file" ? "File" : "Inline";
  }

  function scriptShellLabel(v: Variable): string {
    const c = parseConfig(v.value);
    return SHELL_LABELS[c.shell.shell as ShellKind] ?? c.shell.shell;
  }

  function scriptDescription(v: Variable): string {
    return parseConfig(v.value).description ?? "";
  }

  return (
    <>
      <div className="h-fit rounded-xl bg-card ring-1 ring-foreground/10">
        {scripts.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">
            {selectedFolderId === null ? "No scripts yet." : "This folder is empty."}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Shell</TableHead>
                <TableHead className="w-0 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scripts.map((v) => (
                <TableRow key={v.id}>
                  <TableCell>
                    <span className="font-mono text-xs">{`{${v.name}}`}</span>
                    {scriptDescription(v) && (
                      <span className="ml-2 max-w-56 truncate text-xs text-muted-foreground">{scriptDescription(v)}</span>
                    )}
                  </TableCell>
                  <TableCell><Badge variant="secondary">{scriptSourceLabel(v)}</Badge></TableCell>
                  <TableCell><Badge variant="secondary">{scriptShellLabel(v)}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="outline" size="icon-xs" onClick={() => openEdit(v)}>
                        <PencilIcon />
                      </Button>
                      <Button variant="destructive" size="icon-xs" onClick={() => onRequestDelete(v.id, `{${v.name}}`)}>
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

      {/* ═══ Script dialog ═══ */}
      <Dialog open={dlg} onOpenChange={setDlg}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
          <form onSubmit={(e) => { e.preventDefault(); save(); }}>
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Script" : "Add Script"}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-4">
              <div className="flex items-start gap-3">
                <div className="flex-1 flex flex-col gap-1.5">
                  <label htmlFor="scriptname" className="text-xs font-medium text-muted-foreground">Name</label>
                  <Input id="scriptname" value={name} onChange={(e) => { setName(e.target.value); setError(""); }} placeholder="e.g. publicIp" autoFocus />
                  {error && <span className="text-xs text-destructive">{error}</span>}
                </div>
                <div className="w-44 flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Folder</label>
                  <Select
                    value={folderId === null ? "" : String(folderId)}
                    onValueChange={(v) => setFolderId(v ? Number(v) : null)}
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
                <label className="text-xs font-medium text-muted-foreground">Description <span className="font-normal text-muted-foreground/60">(optional)</span></label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this script do?" />
              </div>

              <div className="flex flex-col gap-1.5">
                <FieldLabel hint="Inline runs a command typed directly here. Script file runs a script from disk — you pick the file, the interpreter that runs it, and any extra arguments.">
                  Source
                </FieldLabel>
                <Select value={sourceMode} onValueChange={(v) => setSourceMode(v as "inline" | "file")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inline">Inline command</SelectItem>
                    <SelectItem value="file">Script file</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {sourceMode === "inline" ? (
                <div className="flex flex-col gap-1.5">
                  <FieldLabel
                    htmlFor="scriptcommand"
                    hint="The command to run when this script triggers. It is passed to the selected shell (e.g. PowerShell or cmd) exactly as typed — any arguments or flags for the program go inside it, like a normal command line."
                  >
                    Command
                  </FieldLabel>
                  <Textarea
                    id="scriptcommand"
                    ref={commandRef}
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    rows={6}
                    spellCheck={false}
                    className="font-mono text-xs"
                    placeholder="e.g. (Invoke-RestMethod -Uri &quot;https://api.ipify.org&quot;)"
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <FieldLabel hint="A script file on disk that Quill runs when this script triggers. Use Browse… to pick it, or type a path.">
                      Script file
                    </FieldLabel>
                    <div className="flex gap-2">
                      <Input
                        value={filePath}
                        onChange={(e) => setFilePath(e.target.value)}
                        readOnly
                        placeholder="No file selected"
                        className="font-mono text-xs"
                      />
                      <Button variant="outline" size="sm" type="button" onClick={pickFile}>Browse…</Button>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col gap-1.5">
                      <FieldLabel hint="The program used to run the script file — it is prepended to the file in the final command. For example python for a .py file, node for a .js file, or pwsh for a .ps1 file. Use a full path (e.g. C:\Python\python.exe) if the program isn't on your PATH.">
                        Interpreter
                      </FieldLabel>
                      <Input value={interpreter} onChange={(e) => setInterpreter(e.target.value)} placeholder="e.g. python, node" className="font-mono text-xs" />
                    </div>
                    <div className="flex-1 flex flex-col gap-1.5">
                      <FieldLabel hint="Extra arguments passed to the interpreter after the script file path, one or more space-separated flags. For example --verbose to enable verbose output.">
                        Extra args
                      </FieldLabel>
                      <Input value={extraArgs} onChange={(e) => setExtraArgs(e.target.value)} placeholder="e.g. --verbose" className="font-mono text-xs" />
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <FieldLabel hint="The shell that runs the command. Inline commands are passed to it; script files are not shell-dependent. Use Custom to target any command-line interpreter, e.g. bash.exe or sh.exe.">
                  Shell
                </FieldLabel>
                <Select value={shell} onValueChange={(v) => setShell(v as ShellKind)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="powershell">PowerShell</SelectItem>
                      <SelectItem value="cmd">Command Prompt</SelectItem>
                      <SelectItem
                        value="wsl"
                        disabled={wslAvailable === false}
                        title={wslAvailable === false ? "WSL not detected" : undefined}
                      >
                        WSL Bash
                        {wslAvailable === false && <span className="text-muted-foreground"> (not detected)</span>}
                      </SelectItem>
                      <SelectSeparator />
                      <SelectItem value="custom">Custom…</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {shell === "custom" && (
                  <div className="mt-2 flex items-start gap-3">
                    <div className="flex-1 flex flex-col gap-1.5">
                      <FieldLabel hint="The executable to launch, e.g. bash.exe or sh.exe. It receives the command string via the arg flag below.">
                        Executable
                      </FieldLabel>
                      <Input value={customExe} onChange={(e) => setCustomExe(e.target.value)} placeholder="e.g. bash.exe" className="font-mono text-xs" />
                    </div>
                    <div className="w-28 flex flex-col gap-1.5">
                      <FieldLabel htmlFor="customarg" hint="The flag that tells the executable the following argument is the command to run. bash uses -c; nothing is prepended if left empty.">
                        Arg flag
                      </FieldLabel>
                      <Input id="customarg" value={customArgFlag} onChange={(e) => setCustomArgFlag(e.target.value)} placeholder="-c" className="font-mono text-xs" />
                    </div>
                  </div>
                )}
              </div>

              {/* Test Run — primary debugging affordance */}
              <div className="flex flex-col gap-2 border-t pt-3">
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" type="button" onClick={testRun} disabled={testState === "running"}>
                    {testState === "running" ? <Loader2 className="size-3.5 animate-spin" /> : <Play />}
                    {testState === "running" ? "Running…" : "Test Run"}
                  </Button>
                  <span className="text-xs text-muted-foreground">Runs now with no trigger context</span>
                </div>
                {testResult && (
                  <pre
                    className={`max-h-40 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs whitespace-pre-wrap ${
                      testResult.ok ? "text-foreground" : "text-destructive"
                    }`}
                  >
                    {testResult.text || "(no output)"}
                  </pre>
                )}
              </div>

              {/* Advanced */}
              <div className="flex flex-col gap-2 border-t pt-3">
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                >
                  {showAdvanced ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                  Advanced
                </button>
                {showAdvanced && (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-4">
                      <div className="flex flex-col gap-1.5">
                        <FieldLabel htmlFor="scripttimeout" hint="How long the script may run before Quill stops it and reports a timeout. Commands that take a while (pings, api calls) may need more than the default 5000 ms.">
                          Timeout (ms)
                        </FieldLabel>
                        <Input
                          id="scripttimeout"
                          type="number"
                          min={MIN_TIMEOUT}
                          max={MAX_TIMEOUT}
                          value={timeoutMs}
                          onChange={(e) => setTimeoutMs(e.target.value)}
                          className="w-32 font-mono text-xs"
                        />
                        <span className="text-[11px] text-muted-foreground/70">500 – 30000</span>
                      </div>
                      <div className="flex flex-col gap-1">
  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <input type="checkbox" checked={trimOutput} onChange={(e) => setTrimOutput(e.target.checked)} className="size-3.5 accent-primary" />
                          Trim output
                        </label>
  <Tooltip>
    <TooltipTrigger render={<span className="inline-flex cursor-help items-center" tabIndex={0} />}>
      <Info className="size-3.5 text-muted-foreground/60" />
    </TooltipTrigger>
    <TooltipContent>When enabled, leading and trailing blank lines/whitespace are stripped from the script's output before it is pasted. Disable to keep exact output.</TooltipContent>
  </Tooltip>
</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button type="submit">{editing ? "Update" : "Add"}</Button>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default ScriptsTab;
