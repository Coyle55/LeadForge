"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { Input } from "@repo/design-system/components/ui/input";
import { Label } from "@repo/design-system/components/ui/label";
import { Textarea } from "@repo/design-system/components/ui/textarea";
import { useActionState } from "react";
import {
  createProspect,
  type ProspectFormState,
  updateProspect,
} from "../../actions/prospects";

interface Fields {
  businessName: string;
  contactEmail: string;
  contactName: string;
  location: string;
  notes: string;
  phone: string;
  websiteUrl: string;
}

const FieldError = ({ errors }: { errors?: string[] }) =>
  errors?.[0] ? <p className="text-destructive text-xs">{errors[0]}</p> : null;

export const ProspectForm = ({
  mode,
  prospectId,
  initial,
}: {
  mode: "create" | "edit";
  prospectId?: string;
  initial: Fields;
}) => {
  const [state, action, pending] = useActionState<ProspectFormState, FormData>(
    mode === "create" ? createProspect : updateProspect,
    {}
  );
  let submitLabel = mode === "create" ? "Create prospect" : "Save changes";
  if (pending) {
    submitLabel = "Saving…";
  }
  const field = (name: keyof Fields, label: string, type = "text") => (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Input defaultValue={initial[name]} id={name} name={name} type={type} />
      <FieldError errors={state.fieldErrors?.[name]} />
    </div>
  );

  return (
    <form action={action} className="space-y-6">
      {prospectId ? (
        <input name="prospectId" type="hidden" value={prospectId} />
      ) : null}
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          {field("businessName", "Business name")}
        </div>
        {field("websiteUrl", "Website")}
        {field("location", "Location")}
        {field("contactName", "Contact name")}
        {field("contactEmail", "Contact email", "email")}
        {field("phone", "Phone", "tel")}
      </div>
      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          defaultValue={initial.notes}
          id="notes"
          maxLength={5000}
          name="notes"
          rows={7}
        />
        <FieldError errors={state.fieldErrors?.notes} />
      </div>
      <div className="flex items-center gap-4">
        <Button disabled={pending} type="submit">
          {submitLabel}
        </Button>
        {state.message ? (
          <p
            className={
              state.status === "error"
                ? "text-destructive text-sm"
                : "text-emerald-600 text-sm"
            }
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
};
