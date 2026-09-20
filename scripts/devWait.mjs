// Waiting for the app on a device to reach a state, instead of sleeping for
// a number picked by guessing.
//
// Driving the emulator means a long tail of "is it up yet": Metro bundles,
// Expo Go downloads, the splash holds, a route mounts. Every one of those was
// being waited on with a fixed `adb shell sleep 45` — a number that is both
// too long (most of the time) and too short (the time it matters, when the
// screenshot catches a splash and the run is read as a failure). Polling the
// screen for the thing you are actually waiting for is shorter AND more
// reliable than any constant.
//
// The screen is read through `uiautomator dump`, which gives the text of the
// rendered accessibility tree — the same text a screenshot shows, but as a
// string this can match on rather than an image someone has to look at.

import { execFileSync } from "node:child_process";
import { androidEnv } from "./androidSdk.mjs";

const POLL_INTERVAL_MS = 1000;

// uiautomator writes XML with the visible strings in text="..." attributes.
// Entities are decoded because a label like "Can't reach the server" arrives
// as "Can&apos;t reach the server", and nobody writing a --text argument
// should have to know that.
export function parseScreenText(xml) {
  const decode = (value) =>
    value
      .replaceAll("&quot;", '"')
      .replaceAll("&apos;", "'")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&amp;", "&");
  return [...xml.matchAll(/text="([^"]*)"/g)].map((match) => decode(match[1])).filter((text) => text !== "");
}

export function screenHasText(xml, needle) {
  const wanted = needle.toLowerCase();
  return parseScreenText(xml).some((text) => text.toLowerCase().includes(wanted));
}

// Bounded and never throwing, like the other adb reads here: a device that is
// mid-reboot, or an app that is not drawing yet, is "no text on screen" — a
// state to keep polling through, not an error to abort on.
export function readScreenText(serial, { exec = execFileSync, timeoutMs = 10000 } = {}) {
  const run = (args) =>
    exec("adb", ["-s", serial, ...args], {
      encoding: "utf8",
      timeout: timeoutMs,
      env: { ...process.env, ...androidEnv(), LC_ALL: "C" },
      maxBuffer: 16 * 1024 * 1024,
    });
  try {
    run(["shell", "uiautomator", "dump", "/sdcard/ui.xml"]);
    return run(["shell", "cat", "/sdcard/ui.xml"]) ?? "";
  } catch {
    return "";
  }
}

/** Polls until `needle` is on screen (or gone, with `absent`). Resolves the
 *  outcome rather than throwing on timeout: the caller decides whether a
 *  timeout is fatal, and always wants the elapsed time and last screen to
 *  report — "timed out after 60s, screen showed the splash" is actionable in
 *  a way that a bare non-zero exit is not. */
export async function waitForText(
  serial,
  needle,
  { absent = false, timeoutMs = 60000, intervalMs = POLL_INTERVAL_MS, read = readScreenText, now = Date.now, sleep } = {},
) {
  const rest = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const started = now();
  let screen = [];
  for (;;) {
    const xml = read(serial);
    screen = parseScreenText(xml);
    if (screenHasText(xml, needle) !== absent) return { found: true, elapsedMs: now() - started, screen };
    if (now() - started >= timeoutMs) return { found: false, elapsedMs: now() - started, screen };
    await rest(intervalMs);
  }
}
