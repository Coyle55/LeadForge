"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { Input } from "@repo/design-system/components/ui/input";
import { Label } from "@repo/design-system/components/ui/label";
import { useActionState } from "react";
import { type SettingsState, updateDisplayName } from "../../actions/settings";

export const SettingsForm = ({ displayName }: { displayName: string }) => {
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    updateDisplayName,
    {}
  );

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="displayName">Display name</Label>
        <Input
          defaultValue={displayName}
          id="displayName"
          maxLength={80}
          name="displayName"
          required
        />
      </div>
      <Button disabled={pending} type="submit">
        {pending ? "Saving…" : "Save settings"}
      </Button>
      {state.message ? (
        <p
          className={
            state.status === "error"
              ? "text-destructive text-sm"
              : "text-green-700 text-sm"
          }
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
};
