#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { claimThisWorktreeSlot } from "./devClaim.mjs";
import { devDataDirEnv } from "./devDataDir.mjs";
import { assertAdoptedBackendMatches, ensureSharedBuilt, resetDevDataIfRequested, seedCommunityGraph, seedDevAccount, seedEditionWorks, seedFixtureUsers } from "./devFixtureSetup.mjs";
import { isPortOpen, spawnDetached, waitFor } from "./devProcess.mjs";
import { readDevUserId, webBackendEnv, webUrls } from "./devWeb.mjs";
import { CERT_PATH, KEY_PATH, mobileCertsExist } from "./mobileCertPaths.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const frontendDir = join(repoRoot, "frontend");
const runtimeDir = join(tmpdir(), "scripta-dev-web");
const resetRequested = process.argv.includes("--reset");

function log(message) {
  console.error(`[dev-web] ${message}`);
}

async function main() {
  const { ports, branch, slot } = await claimThisWorktreeSlot({ repoRoot });
  log(`Slot ${slot} — backend ${ports.backend}, web ${ports.vite} (${branch}).`);
  if (resetRequested && (await isPortOpen(ports.backend))) {
    throw new Error(`a backend is running on ${ports.backend}; run npm run dev:release before --reset`);
  }
  ensureSharedBuilt(log);
  resetDevDataIfRequested(resetRequested, log);
  seedDevAccount(resetRequested, log);
  seedEditionWorks(log);
  seedFixtureUsers(log);
  seedCommunityGraph(log);

  const account = JSON.parse(readFileSync(join(repoRoot, "scripts", "fixtures", "account.json"), "utf8"));
  const adminUserId = readDevUserId(devDataDirEnv().AUTH_DB_PATH, account.email);
  const https = mobileCertsExist();
  const expected = webBackendEnv({ adminUserId, https, vitePort: ports.vite, apiPort: ports.backend, certPath: CERT_PATH, keyPath: KEY_PATH });

  if (await isPortOpen(ports.backend)) {
    assertAdoptedBackendMatches(ports.backend, log, expected);
    log(`Backend already listening on ${ports.backend}.`);
  } else {
    log("Starting the backend...");
    spawnDetached("npm", ["run", "backend"], { cwd: repoRoot, env: { ...process.env, ...expected }, logName: "backend.log", runtimeDir });
    await waitFor(() => isPortOpen(ports.backend), { timeoutMs: 30_000, label: `backend on port ${ports.backend}` });
  }

  if (await isPortOpen(ports.vite)) {
    log(`Vite already listening on ${ports.vite}.`);
  } else {
    log("Starting Vite...");
    spawnDetached("npm", ["run", "dev"], { cwd: frontendDir, env: process.env, logName: "vite.log", runtimeDir });
    await waitFor(() => isPortOpen(ports.vite), { timeoutMs: 60_000, label: `Vite on port ${ports.vite}` });
  }

  log("Release both with `npm run dev:release` when done.");
  console.log(JSON.stringify(webUrls({ vitePort: ports.vite, apiPort: ports.backend, https })));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
