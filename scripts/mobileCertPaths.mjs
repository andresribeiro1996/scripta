// Where the mobile-testing TLS cert/key live, and how to find them from
// anywhere in the repo without hardcoding a path relative to whichever
// directory happens to be running.
//
// Every consumer needs the exact same two files:
//   scripts/gen-mobile-certs.mjs        writes them
//   backend/src/config/devCerts.ts      reads them, to serve the API over https
//   frontend/vite.config.ts             reads them, to serve the app over https
//   backend/scripts/dev-mobile.mjs      only checks they exist, to log http vs https
//
// One shared module means all four agree on the location by construction
// — there's no second path string to let drift out of sync.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** Repo root — this file lives at <root>/scripts/mobileCertPaths.mjs. */
export const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export const CERT_DIR = join(repoRoot, ".certs");
export const CERT_PATH = join(CERT_DIR, "mobile-cert.pem");
export const KEY_PATH = join(CERT_DIR, "mobile-key.pem");

export function mobileCertsExist() {
  return existsSync(CERT_PATH) && existsSync(KEY_PATH);
}
