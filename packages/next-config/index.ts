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
  // Turbopack dev mode cannot run in this app -- confirmed a genuine,
  // currently-unfixed upstream bug (prisma/prisma#28956, #29025;
  // vercel/next.js#87737, #86866, all open), not a local config issue.
  // Turbopack auto-externalizes @prisma/client/@prisma/adapter-pg/pg
  // (they have dynamic requires it flags automatically) and computes an
  // internal content-hashed specifier for each (e.g.
  // "@prisma/client-<hash>/runtime/client") that nothing at runtime can
  // ever resolve. Tried and confirmed NOT to fix it: serverExternalPackages
  // alone, serverExternalPackages + turbopack.resolveAlias (both absolute
  // and relative path forms), and removing serverExternalPackages entirely
  // to force full bundling instead. `bun run dev` therefore runs Next with
  // `--webpack` (see apps/app/package.json) until upstream fixes this.
  // serverExternalPackages here still matters for the real webpack build
  // (`next build`/`next start`), unaffected by the Turbopack-specific bug.
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],
};

export const withAnalyzer = (sourceConfig: NextConfig): NextConfig =>
  withBundleAnalyzer()(sourceConfig);
