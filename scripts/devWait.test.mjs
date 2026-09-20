import assert from "node:assert/strict";
import { test } from "node:test";
import { parseScreenText, screenHasText, waitForText } from "./devWait.mjs";

// An abridged `uiautomator dump`: every node carries a text attribute, and
// all but a couple are empty (layout nodes), which is why the empties are
// dropped rather than matched against.
const SCREEN = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<hierarchy rotation="0"><node text="" class="android.widget.FrameLayout">',
  '<node text="Atmyshelf" class="android.widget.TextView" />',
  '<node text="Can&apos;t reach the server. Check your connection." class="android.widget.TextView" />',
  '<node text="Sign in" class="android.widget.TextView" />',
  "</node></hierarchy>",
].join("");

const SPLASH = '<hierarchy><node text="" class="android.widget.ImageView" /></hierarchy>';

test("parseScreenText keeps the visible strings and drops the empty layout nodes", () => {
  assert.deepEqual(parseScreenText(SCREEN), [
    "Atmyshelf",
    "Can't reach the server. Check your connection.",
    "Sign in",
  ]);
  assert.deepEqual(parseScreenText(SPLASH), []);
});

test("screenHasText matches a substring, decoded and case-insensitively", () => {
  assert.equal(screenHasText(SCREEN, "Sign in"), true);
  assert.equal(screenHasText(SCREEN, "sign in"), true);
  // Written the way it reads on screen, not the way uiautomator escapes it.
  assert.equal(screenHasText(SCREEN, "Can't reach"), true);
  assert.equal(screenHasText(SCREEN, "Create account"), false);
});

test("waitForText returns as soon as the text appears, without waiting out the timeout", async () => {
  let clock = 0;
  const screens = [SPLASH, SPLASH, SCREEN];
  const result = await waitForText("emulator-5554", "Sign in", {
    read: () => screens.shift() ?? SCREEN,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    intervalMs: 1000,
    timeoutMs: 60000,
  });
  assert.equal(result.found, true);
  assert.equal(result.elapsedMs, 2000);
});

test("waitForText gives up at the timeout and hands back the last screen", async () => {
  let clock = 0;
  const result = await waitForText("emulator-5554", "Sign in", {
    read: () => SPLASH,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    intervalMs: 1000,
    timeoutMs: 3000,
  });
  assert.equal(result.found, false);
  assert.equal(result.elapsedMs, 3000);
  assert.deepEqual(result.screen, []);
});

test("a device that answers nothing is polled through, not treated as an error", async () => {
  let clock = 0;
  const screens = ["", "", SCREEN];
  const result = await waitForText("emulator-5554", "Atmyshelf", {
    read: () => screens.shift() ?? SCREEN,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    intervalMs: 500,
    timeoutMs: 10000,
  });
  assert.equal(result.found, true);
  assert.equal(result.elapsedMs, 1000);
});

test("--absent waits for something to go away", async () => {
  let clock = 0;
  const screens = [SCREEN, SCREEN, SPLASH];
  const result = await waitForText("emulator-5554", "Sign in", {
    absent: true,
    read: () => screens.shift() ?? SPLASH,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    intervalMs: 1000,
    timeoutMs: 60000,
  });
  assert.equal(result.found, true);
  assert.equal(result.elapsedMs, 2000);
});
