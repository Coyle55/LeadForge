"use client";

import type { BusinessCategory } from "@repo/database";
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
  businessCategory: string;
  businessName: string;
  contactEmail: string;
  contactName: string;
  location: string;
  notes: string;
  phone: string;
  websiteUrl: string;
}

export const BUSINESS_CATEGORY_OPTIONS = [
  ["SALON_SPA", "Salon / Spa"],
  ["MEDICAL_DENTAL", "Medical / Dental"],
  ["HOME_SERVICES", "Home Services"],
  ["AUTOMOTIVE", "Automotive"],
  ["FITNESS", "Fitness"],
  ["LEGAL_FINANCIAL", "Legal / Financial"],
  ["RESTAURANT_FOOD", "Restaurant / Food"],
  ["RETAIL", "Retail"],
  ["PROFESSIONAL_SERVICES", "Professional Services"],
  ["OTHER", "Other"],
] as const satisfies ReadonlyArray<readonly [BusinessCategory, string]>;

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
        <div className="space-y-2">
          <Label htmlFor="businessCategory">Business category</Label>
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30"
            defaultValue={initial.businessCategory}
            id="businessCategory"
            name="businessCategory"
          >
            <option value="">Not set</option>
            {BUSINESS_CATEGORY_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <FieldError errors={state.fieldErrors?.businessCategory} />
        </div>
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
