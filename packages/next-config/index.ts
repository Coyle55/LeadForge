import path from "node:path";
import { fileURLToPath } from "node:url";
import withBundleAnalyzer from "@next/bundle-analyzer";
import type { NextConfig } from "next";

// This package lives at <repo-root>/packages/next-config, two levels below
// the actual monorepo root -- resolving from this file's own location (not
// process.cwd()) keeps this correct regardless of which checkout or git
// worktree the app is running from. Without it, Turbopack can walk past a
// worktree's own lockfile to an ancestor checkout's lockfile (e.g. a
// worktree nested under the main repo, per this project's own git-worktree
// workflow) and infer the wrong workspace root, breaking module resolution
// for generated/hashed packages like the Prisma client.
const monorepoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

export const config: NextConfig = {
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "img.clerk.com",
      },
    ],
  },
  turbopack: {
    root: monorepoRoot,
  },
  // Bun only links these into packages/database/node_modules, not hoisted
  // to a workspace root -- without this, Turbopack's dev-mode external
  // module handling for server-only packages resolves them to an internal
  // content-hashed specifier (e.g. "@prisma/client-<hash>/runtime/client")
  // that Node can never actually find at runtime.
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],
};

export const withAnalyzer = (sourceConfig: NextConfig): NextConfig =>
  withBundleAnalyzer()(sourceConfig);
