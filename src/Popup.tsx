import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Snippet {
  id: number;
  trigger: string;
  expansion: string;
  whole_word: boolean;
  created_at: string;
}

function Popup() {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const win = getCurrentWindow();
    invoke<Snippet[]>("get_snippets").then(setSnippets);
    inputRef.current?.focus();
    win.onFocusChanged(({ payload: focused }) => {
      if (!focused) win.close();
    });
  }, []);

  const filtered = snippets.filter((s) => {
    const q = query.toLowerCase();
    return s.trigger.toLowerCase().includes(q) || s.expansion.toLowerCase().includes(q);
  });

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  async function select(idx: number) {
    const s = filtered[idx];
    if (!s) return;
    await invoke("close_and_inject", { expansion: s.expansion });
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      getCurrentWindow().close();
    } else if (e.key === "ArrowDown" || e.key === "Tab") {
      e.preventDefault();
      setSelectedIdx((i) => (i < filtered.length - 1 ? i + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => (i > 0 ? i - 1 : filtered.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      select(selectedIdx);
    }
  }

  return (
    <div className="flex h-screen flex-col bg-popover text-popover-foreground" style={{ fontFamily: "Architects Daughter, sans-serif", letterSpacing: "0.5px" }}>
      <div className="flex shrink-0 items-center gap-2 px-3 py-2.5">
        <img src="/quill-icon.png" alt="" className="size-4 shrink-0 opacity-50" />
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Search snippets..."
          className="flex-1 bg-transparent text-sm text-card-foreground placeholder:text-muted-foreground outline-none"
        />
      </div>
      <div className="h-px shrink-0 bg-border/50" />
      <ScrollArea className="flex-1 min-h-0">
        {filtered.length === 0 && (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            {snippets.length === 0 ? "No snippets yet" : "No matches"}
          </p>
        )}
        <div className="mx-3 space-y-0.5 py-1.5">
          {filtered.map((s, i) => (
            <button
              key={s.id}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                i === selectedIdx
                  ? "bg-accent text-accent-foreground"
                  : "text-popover-foreground hover:bg-accent/30"
              }`}
              onClick={() => select(i)}
              onMouseEnter={() => setSelectedIdx(i)}
            >
              <span className="font-mono text-xs font-medium text-primary">{s.trigger}</span>
              <span className="truncate text-xs text-muted-foreground">{s.expansion}</span>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

export default Popup;
