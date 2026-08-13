"use client";

import { Button } from "@repo/design-system/components/ui/button";
import {
  Dialog,
  DialogTrigger,
} from "@repo/design-system/components/ui/dialog";
import { useState } from "react";
import { DiscoverModal } from "./discover-modal";

export const DiscoverButton = () => {
  const [open, setOpen] = useState(false);
  // Bumped every time the dialog opens so `<DiscoverModal key={openCount} />`
  // fully remounts (clearing search form + results) on every open, without
  // relying on unmounting the Dialog itself -- which would also skip Radix's
  // close-animation and its trigger-focus-return wiring (see DialogTrigger
  // below).
  const [openCount, setOpenCount] = useState(0);

  return (
    <Dialog
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setOpenCount((count) => count + 1);
        }
      }}
      open={open}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          Discover prospects
        </Button>
      </DialogTrigger>
      <DiscoverModal key={openCount} onClose={() => setOpen(false)} />
    </Dialog>
  );
};
