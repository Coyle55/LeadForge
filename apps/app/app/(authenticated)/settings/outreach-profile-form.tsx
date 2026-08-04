"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { Input } from "@repo/design-system/components/ui/input";
import { Label } from "@repo/design-system/components/ui/label";
import { Textarea } from "@repo/design-system/components/ui/textarea";
import { useActionState } from "react";
import {
  type OutreachProfileState,
  updateOutreachProfile,
} from "../../actions/outreach-profile";

interface OutreachProfileFields {
  senderName: string;
  companyName: string;
  serviceOffered: string;
  valueProposition: string;
  defaultCta: string;
}

export const OutreachProfileForm = ({
  initial,
}: {
  initial: OutreachProfileFields;
}) => {
  const [state, action, pending] = useActionState<
    OutreachProfileState,
    FormData
  >(updateOutreachProfile, {});

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="senderName">Sender name</Label>
          <Input
            defaultValue={initial.senderName}
            id="senderName"
            maxLength={80}
            name="senderName"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="companyName">Company name</Label>
          <Input
            defaultValue={initial.companyName}
            id="companyName"
            maxLength={120}
            name="companyName"
            required
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="serviceOffered">Service offered</Label>
        <Textarea
          defaultValue={initial.serviceOffered}
          id="serviceOffered"
          maxLength={300}
          name="serviceOffered"
          required
          rows={3}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="valueProposition">Value proposition</Label>
        <Textarea
          defaultValue={initial.valueProposition}
          id="valueProposition"
          maxLength={600}
          name="valueProposition"
          required
          rows={4}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="defaultCta">Default CTA</Label>
        <Textarea
          defaultValue={initial.defaultCta}
          id="defaultCta"
          maxLength={240}
          name="defaultCta"
          required
          rows={3}
        />
      </div>
      <div className="flex items-center gap-4">
        <Button disabled={pending} type="submit">
          {pending ? "Saving…" : "Save outreach profile"}
        </Button>
        {state.message ? (
          <p
            aria-live="polite"
            className={
              state.status === "error"
                ? "text-destructive text-sm"
                : "text-emerald-600 text-sm"
            }
            role={state.status === "error" ? "alert" : "status"}
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
};
