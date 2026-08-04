import { keys as auth } from "@repo/auth/keys";
import { keys as database } from "@repo/database/keys";
import { keys as core } from "@repo/next-config/keys";
import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
  extends: [auth(), core(), database()],
  server: {
    AI_GATEWAY_MODEL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(1).optional()
    ),
    AI_GATEWAY_API_KEY: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(1).optional()
    ),
  },
  client: {},
  runtimeEnv: {
    AI_GATEWAY_MODEL: process.env.AI_GATEWAY_MODEL,
    AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
  },
});
