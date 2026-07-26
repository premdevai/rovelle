import type { NextConfig } from "next";

// node:sqlite is a builtin, but Next's bundler needs telling not to trace it.
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

export default {
  // A stray package-lock.json in the home directory made Next infer ~/ as the
  // workspace root, so every build warned and file tracing walked the wrong
  // tree. This app is the root.
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  // The e2e suite builds and starts its own server. Without a separate output
  // directory that build fights `next dev` over .next and corrupts both.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  serverExternalPackages: ["node:sqlite"],
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
} satisfies NextConfig;
