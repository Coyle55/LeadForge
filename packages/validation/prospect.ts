import { z } from "zod";

const HTTP_PROTOCOL = /^https?:\/\//i;
const ANY_PROTOCOL = /^[a-z][a-z\d+.-]*:\/\//i;

const optionalText = (maximum: number) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? null : value,
    z.string().trim().max(maximum).nullable()
  );

const optionalWebsite = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z
    .string()
    .trim()
    .transform((value) =>
      HTTP_PROTOCOL.test(value) || ANY_PROTOCOL.test(value)
        ? value
        : `https://${value}`
    )
    .pipe(z.url())
    .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
      message: "Website must use http or https",
    })
    .nullable()
);

const optionalEmail = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().trim().toLowerCase().email().nullable()
);

export const prospectSchema = z.object({
  businessName: z.string().trim().min(1).max(160),
  contactEmail: optionalEmail,
  contactName: optionalText(160),
  location: optionalText(240),
  notes: optionalText(5000),
  phone: optionalText(50),
  websiteUrl: optionalWebsite,
});

export type ProspectInput = z.infer<typeof prospectSchema>;
