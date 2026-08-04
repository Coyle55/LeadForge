"use client";

import { ClerkProvider } from "@clerk/nextjs";
import type { ComponentProps } from "react";

export const AuthProvider = (
  properties: ComponentProps<typeof ClerkProvider>
) => <ClerkProvider {...properties} />;
