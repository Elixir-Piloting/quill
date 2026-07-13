import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  hotkey: string;
  onChange: (hk: string) => void;
}

function HotkeyRecorder({ hotkey, onChange }: Props) {
  const [recording, setRecording] = useState(false);

  function start() { setRecording(true); }

  function clear() { onChange(""); }

  useEffect(() => {
    if (!recording) return;
    function handler(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { setRecording(false); return; }
      const mods: string[] = [];
      if (e.ctrlKey) mods.push("Ctrl");
      if (e.altKey) mods.push("Alt");
      if (e.shiftKey) mods.push("Shift");
      if (e.metaKey) mods.push("Super");
      let key = "";
      if (e.key === " ") key = "Space";
      else if (e.key === "Enter") key = "Enter";
      else if (e.key === "Tab") key = "Tab";
      else if (e.key.startsWith("F") && e.key.length <= 3) key = e.key;
      else if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key)) key = e.key.toUpperCase();
      else return;
      if (mods.length === 0 && !key.startsWith("F")) return;
      const combo = [...mods, key].join("+");
      setRecording(false);
      onChange(combo);
    }
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [recording, onChange]);

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">Search popup hotkey</label>
      <div className="flex items-center gap-2">
        <div
          className={`flex h-8 flex-1 items-center rounded-md border px-3 font-mono text-xs cursor-pointer ${
            recording
              ? "border-dashed text-muted-foreground"
              : "bg-card hover:bg-accent"
          }`}
          onClick={start}
        >
          {recording ? "Press a key combination…" : hotkey || "Not set"}
        </div>
        {hotkey && !recording && (
          <Button variant="ghost" size="xs" onClick={clear} title="Clear hotkey">Clear</Button>
        )}
      </div>
    </div>
  );
}

export default HotkeyRecorder;
