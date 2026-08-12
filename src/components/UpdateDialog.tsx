import { useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { emit } from "@tauri-apps/api/event";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface Props {
  update: Update | null;
  onClose: () => void;
}

export default function UpdateDialog({ update, onClose }: Props) {
  const [installing, setInstalling] = useState(false);

  if (!update) return null;

  async function handleUpdateNow() {
    if (installing || !update) return;
    setInstalling(true);
    try {
      await update.downloadAndInstall();
      await emit("app:restart");
    } catch (e) {
      console.error("[updater] install failed", e);
      onClose();
    } finally {
      setInstalling(false);
    }
  }

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open && !installing) onClose(); }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>New update available</DialogTitle>
          <DialogDescription>
            You're on version {update.currentVersion}. Version {update.version} is available.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={installing}>
            Update Later
          </Button>
          <Button variant="default" size="sm" onClick={handleUpdateNow} disabled={installing}>
            {installing ? "Installing…" : "Update Now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}