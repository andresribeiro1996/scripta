// Copies the non-TypeScript files that modules read from disk at runtime
// into dist/, preserving their path relative to src/.
//
// `tsc` compiles .ts and copies nothing else, but several modules read a
// sibling file at runtime relative to their own location — each SQLite
// adapter's schema.sql, and auth's public/console.html. Without this step
// `npm start` dies at boot on the first missing schema, which is why
// `npm run build`/`npm start` had never actually worked (see README).
//
// Deliberately a script rather than a shell one-liner in package.json:
// `cp --parents` is GNU-only, so a one-liner would build on Linux CI and
// fail on a contributor's macOS machine.

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "node:fs/promises";

const backendDir = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(backendDir, "src");
const distDir = join(backendDir, "dist");

// Extend this list if a module starts reading another file type at
// runtime. Anything matched here is copied verbatim.
const PATTERNS = ["**/*.sql", "**/*.html"];

if (!existsSync(distDir)) {
  console.error("dist/ does not exist — run `tsc` before this script.");
  process.exit(1);
}

let copied = 0;
for (const pattern of PATTERNS) {
  for await (const match of glob(pattern, { cwd: srcDir })) {
    const from = join(srcDir, match);
    const to = join(distDir, match);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
    copied++;
  }
}

if (copied === 0) {
  // Not a warning to shrug at: every module needs its schema.sql, so zero
  // copies means the build is silently producing something that cannot boot.
  console.error("copy-assets: matched no files — dist/ will not be runnable.");
  process.exit(1);
}

console.log(`copy-assets: copied ${copied} runtime asset${copied === 1 ? "" : "s"} into dist/`);
