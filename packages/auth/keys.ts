import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const keys = () =>
  createEnv({
    skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
    server: {
      CLERK_SECRET_KEY: z.string().startsWith("sk_").optional(),
      ALLOWED_USER_IDS: z.string().min(1),
    },
    client: {
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z
        .string()
        .startsWith("pk_")
        .optional(),
      NEXT_PUBLIC_CLERK_SIGN_IN_URL: z.string().startsWith("/").optional(),
      NEXT_PUBLIC_CLERK_SIGN_UP_URL: z.string().startsWith("/").optional(),
      NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL: z
        .string()
        .startsWith("/")
        .optional(),
      NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL: z
        .string()
        .startsWith("/")
        .optional(),
    },
    runtimeEnv: {
      CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
      ALLOWED_USER_IDS: process.env.ALLOWED_USER_IDS,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
        process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      NEXT_PUBLIC_CLERK_SIGN_IN_URL: process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL,
      NEXT_PUBLIC_CLERK_SIGN_UP_URL: process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL,
      NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL:
        process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL,
      NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL:
        process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL,
    },
  });
