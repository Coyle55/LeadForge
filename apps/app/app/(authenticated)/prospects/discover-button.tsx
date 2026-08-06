"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { useState } from "react";
import { DiscoverModal } from "./discover-modal";

export const DiscoverButton = () => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} type="button" variant="outline">
        Discover prospects
      </Button>
      {open ? <DiscoverModal onClose={() => setOpen(false)} /> : null}
    </>
  );
};
