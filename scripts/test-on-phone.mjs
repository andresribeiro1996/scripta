#!/usr/bin/env node
// `node scripts/test-on-phone.mjs` — one command instead of the whole
// checklist in the root README's "Testing on a phone" section: installs
// whatever's missing, generates a dev .env if there isn't one yet,
// starts both dev servers wired for the LAN, and prints the url to open
// on the phone. Ctrl-C stops both.
//
// This only orchestrates — the actual LAN/https logic (detecting this
// machine's address, setting PUBLIC_API_URL/ALLOW_LAN_ORIGINS, picking
// up a generated cert) lives where it already did, in backend/scripts/
// dev-mobile.mjs and frontend/scripts/build-mobile.mjs — this just runs
// `npm run dev:mobile` in both directories and keeps their output
// readable side by side. Nothing here is a shortcut past those; it's
// the setup steps that used to be manual.
//
//   node scripts/test-on-phone.mjs          quick browsing, plain http
//   node scripts/test-on-phone.mjs --https  + install/offline (PWA) —
//                                            generates a cert first if
//                                            needed, then builds and
//                                            serves the frontend instead
//                                            of running it in dev mode
//                                            (see gen-mobile-certs.mjs
//                                            and build-mobile.mjs for why)

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { repoRoot, mobileCertsExist } from "./mobileCertPaths.mjs";

const useHttps = process.argv.includes("--https") || process.argv.includes("--pwa");

const backendDir = join(repoRoot, "backend");
const frontendDir = join(repoRoot, "frontend");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    console.error(`\ntest-on-phone: \`${cmd} ${args.join(" ")}\` failed in ${cwd}`);
    process.exit(result.status ?? 1);
  }
}

function ensureInstalled(dir, label) {
  if (!existsSync(join(dir, "node_modules"))) {
    console.log(`Installing ${label} dependencies (first run only)...`);
    run(npmCmd, ["install"], dir);
  }
}

/**
 * backend/.env doesn't ship committed (see backend/.gitignore) — it's
 * copied from .env.example on first run here, same as the "Getting
 * started" section in the root README already asks you to do by hand.
 * The three secrets .env.example leaves as literal "replace-me..."
 * placeholders are filled with real random values so the server can
 * actually boot; everything else (Google/social/Hardcover integrations)
 * is left blank exactly as .env.example has it — those features stay
 * off, same "quietly skipped" behavior as any other dev setup, not
 * something this script should be guessing values for.
 */
function ensureBackendEnv() {
  const envPath = join(backendDir, ".env");
  if (existsSync(envPath)) return;

  console.log("No backend/.env yet — creating one from .env.example with generated secrets...");
  let contents = readFileSync(join(backendDir, ".env.example"), "utf8");
  const placeholders = [
    "replace-me-with-a-random-64-char-hex-string",
    "replace-me-with-a-different-random-64-char-hex-string"
  ];
  for (const placeholder of placeholders) {
    contents = contents.replace(placeholder, randomBytes(48).toString("hex"));
  }
  // SOCIALS_ENCRYPTION_KEY has no placeholder text to replace — .env.example
  // leaves it genuinely blank (see that file's own comment) — so this is
  // appended as a real value the same way the other two secrets are,
  // rather than left empty (an empty key there fails validation the
  // moment the socials module boots).
  contents = contents.replace(/^SOCIALS_ENCRYPTION_KEY=$/m, `SOCIALS_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}`);
  writeFileSync(envPath, contents);
}

ensureInstalled(backendDir, "backend");
ensureInstalled(frontendDir, "frontend");
ensureBackendEnv();

if (useHttps && !mobileCertsExist()) {
  console.log("No mobile TLS cert yet — generating one (node scripts/gen-mobile-certs.mjs)...\n");
  run(process.execPath, [join(repoRoot, "scripts", "gen-mobile-certs.mjs")], repoRoot);
  console.log("");
}

/** Runs `npm run <script>` in `dir`, prefixing every line of its output
 *  with `[label]` so backend and frontend output stay tellable apart
 *  when interleaved in one terminal.
 *
 *  `detached: true` on POSIX puts the child in its own new process
 *  group (id == its own pid) rather than this script's — needed
 *  because both backend/scripts/dev-mobile.mjs and Vite themselves
 *  spawn further children of their own (tsx watch, etc.), so a plain
 *  `child.kill()` here would only stop the immediate `npm` process and
 *  leave that whole grandchild tree running. killTree() below signals
 *  the group instead. */
function spawnDevServer(label, script, dir) {
  const child = spawn(npmCmd, ["run", script], {
    cwd: dir,
    shell: process.platform === "win32",
    detached: process.platform !== "win32"
  });
  const prefix = (data) =>
    data
      .toString()
      .split("\n")
      .filter((line, i, lines) => line !== "" || i < lines.length - 1)
      .map((line) => `[${label}] ${line}`)
      .join("\n") + "\n";
  child.stdout.on("data", (data) => process.stdout.write(prefix(data)));
  child.stderr.on("data", (data) => process.stderr.write(prefix(data)));
  return child;
}

const children = [
  spawnDevServer("backend", "dev:mobile", backendDir),
  spawnDevServer("frontend", useHttps ? "preview:mobile" : "dev:mobile", frontendDir)
];

/** Kills `child` AND everything it spawned — see spawnDevServer's own
 *  comment for why a plain child.kill() isn't enough here. */
function killTree(child) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"]);
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // Group's already gone — nothing to do.
    }
  }
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) killTree(child);
}

// If either dev server dies on its own (a crash, a build error in
// --https mode), take the other down with it rather than leaving one
// half running with nothing to talk to.
for (const child of children) {
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(`\ntest-on-phone: one process exited (code ${code}, signal ${signal}) — stopping the other.`);
    shutdown();
    process.exitCode = code ?? 1;
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
