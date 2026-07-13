import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button } from "@/components/ui/button";
import { Settings, Minus, Square, Copy, X } from "lucide-react";

interface Props {
  paused: boolean;
  closeToTray: boolean;
  onTogglePause: () => void;
  onOpenSettings: () => void;
}

function Titlebar({ paused, closeToTray, onTogglePause, onOpenSettings }: Props) {
  const appWindow = getCurrentWindow();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    appWindow.isMaximized().then(setMaximized);
    const unlisten = appWindow.onResized(() => { appWindow.isMaximized().then(setMaximized); });
    return () => { unlisten.then((f) => f()); };
  }, []);

  return (
    <header data-tauri-drag-region className="flex h-9 shrink-0 items-center justify-between bg-card pl-3 pr-1 ring-1 ring-foreground/5">
      <div className="flex items-center gap-2">
        <img src="/quill-icon.png" alt="Quill" className="size-4" />
        <span className="font-heading text-xs font-semibold">Quill</span>
      </div>
      <div className="flex items-center">
        {paused ? (
          <Button variant="outline" size="xs" onClick={onTogglePause} className="border-destructive text-destructive hover:bg-destructive/10">
            <span className="size-1.5 rounded-full bg-destructive" />
            Paused
          </Button>
        ) : (
          <Button variant="default" size="xs" onClick={onTogglePause}>
            <span className="size-1.5 rounded-full bg-primary-foreground" />
            Active
          </Button>
        )}
        <Button variant="ghost" size="icon-xs" onClick={onOpenSettings} title="Settings">
          <Settings />
        </Button>
        <div className="mx-0.5 h-3 w-px bg-border" />
        <Button variant="ghost" size="icon-xs" onClick={() => appWindow.minimize()} title="Minimize">
          <Minus />
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={() => appWindow.toggleMaximize()} title={maximized ? "Restore" : "Maximize"}>
          {maximized ? <Copy /> : <Square />}
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={() => { if (closeToTray) appWindow.hide(); else appWindow.close(); }} title="Close" className="hover:bg-destructive hover:text-destructive-foreground">
          <X />
        </Button>
      </div>
    </header>
  );
}

export default Titlebar;
