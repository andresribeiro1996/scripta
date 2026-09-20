// Guards the one assumption dev-phone.mjs and dev-emulator.mjs both make and
// neither could check: that a backend already listening on this slot's port
// is one THEY started, against backend/data/dev/.
//
// Adopting a mismatched server fails silently and convincingly. A backend
// started before scripts/devDataDir.mjs learned about a module — or by a bare
// `npm run backend` — serves that module out of backend/data/ instead, so the
// app comes up, the other modules read the fixture, and only the one served
// from the wrong file looks empty or stale. That cost real debugging time
// once (the community module, missing from DB_MODULES until 2026-09-19): the
// feed rendered the developer's own events while every other screen showed
// fixture data, and nothing anywhere said why.
//
// Reading another process's environment is best-effort by nature — a missing
// lsof, a platform that hides it, a pid that exits mid-check. None of that
// should stop a dev script, so an unreadable environment adopts as before and
// only a CONFIRMED difference refuses.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** `ps eww` prints the environment space-separated on one line, so a value
 *  containing a space can't be split on whitespace. Slicing between `KEY=`
 *  boundaries keeps those values intact — a path under "Documents and
 *  Settings" would otherwise silently parse as two entries. */
export function parsePsEnv(output) {
  const env = {};
  const pattern = /(?:^|\s)([A-Za-z_][A-Za-z0-9_]*)=/g;
  const starts = [];
  for (let match = pattern.exec(output); match; match = pattern.exec(output)) {
    starts.push({ name: match[1], from: match.index + match[0].length });
  }
  for (const [index, entry] of starts.entries()) {
    const next = starts[index + 1];
    const end = next ? output.lastIndexOf(`${next.name}=`, next.from) : output.length;
    env[entry.name] = output.slice(entry.from, end).trim();
  }
  return env;
}

/** Linux's /proc/<pid>/environ is NUL-separated and exact, so it beats
 *  parsing ps output wherever it exists. */
export function parseProcEnviron(raw) {
  const env = {};
  for (const entry of raw.split("\0")) {
    const split = entry.indexOf("=");
    if (split > 0) env[entry.slice(0, split)] = entry.slice(split + 1);
  }
  return env;
}

export function readProcessEnv(pid, { exec = execFileSync, readFile = readFileSync } = {}) {
  try {
    return parseProcEnviron(readFile(`/proc/${pid}/environ`, "utf8"));
  } catch {
    // Not Linux, or the file is unreadable — fall through to ps.
  }
  try {
    return parsePsEnv(exec("ps", ["eww", "-p", String(pid)], { encoding: "utf8" }));
  } catch {
    return null;
  }
}

/** Only the keys the caller would have set are compared: a running backend
 *  carries plenty of environment this workflow neither sets nor cares about,
 *  and an unset key on the other side is exactly the failure being looked
 *  for (the var that was never added to the module list). */
export function mismatchedEnv(actual, expected) {
  const rows = [];
  for (const [name, want] of Object.entries(expected)) {
    const got = actual[name];
    if (got !== want) rows.push({ name, expected: want, actual: got ?? null });
  }
  return rows;
}

export function describeMismatch(port, rows) {
  const lines = rows.map((row) => `  ${row.name}\n    running: ${row.actual ?? "(not set)"}\n    wanted:  ${row.expected}`);
  return [
    `The backend already listening on ${port} was started with a different data directory,`,
    "so adopting it would serve some modules out of the wrong database.",
    ...lines,
    "Free the slot and let this script start it again: npm run dev:release",
  ].join("\n");
}
