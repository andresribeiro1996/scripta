# Beta Tester Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `beta-tester` agent that sweeps the whole Scripta mobile app on the leased Android emulator and writes a ranked report of bugs and UX problems with screenshots.

**Architecture:** A pure snapshot module (`scripts/devSnapshot.mjs`) turns one screencap plus one uiautomator dump into a shrunk PNG and a compact text listing of the screen's controls; a thin CLI (`scripts/dev-snapshot.mjs`) runs it against this worktree's emulator lease. A saved Sonnet agent (`.claude/agents/beta-tester.md`) drives the app with that listing on top of the existing `emulator-verify` skill, and appends findings to `report.md` as it goes.

**Tech Stack:** Node ≥ 22 ESM scripts (stdlib only), `node:test`, adb, macOS `sips`, Claude Code saved agents.

**Spec:** `docs/superpowers/specs/2026-10-04-beta-tester-agent-design.md`

## Global Constraints

- No comments in code (AGENTS.md). The why goes in the commit message.
- Stdlib only; no new dependencies.
- Root script tests run as `npm run test:scripts` (`node --test scripts/*.test.mjs`), and CI runs them on Ubuntu with no Android SDK. `androidEnv()` throws there, so tests always inject `exec`/`read` and never reach `runTool` or `readScreenText`.
- Touch-target floor: 44dp. Label clip: 60 characters with `…`. Screenshot shrink: `sips -Z 1200`.
- Run git from the worktree root. Stage and commit in one Bash call (other sessions share the index).
- Device passes go to `device-checker`, never `general-purpose`. Before one, run `node scripts/dev-status.mjs --json` once.
- The tester never edits source, commits or pushes; it never writes `backend/data/`, a `.sqlite` file or fixtures directly.

## Review Focus

1. **Text containing a newline** (`&#10;` in the dump): each control must still be exactly one listing row, with the newline shown as a space. Pinned in Task 1, test 3.
2. **Touch targets just under 44dp at real density 420:** 115px must be flagged and print `43`, never `44 … ⚠`; 116px must not be flagged. Pinned in Task 1, test 2.
3. **React Native buttons whose text sits on child nodes, and icon buttons with no label:** the tap row takes its children's text; an unlabeled one prints `(no label)`, not `""`. Pinned in Task 1, test 1, and checked on a real dump in Task 2.
4. **A dump taken mid-transition comes back empty:** retry once, then keep the screenshot and say "dump failed — screenshot only" rather than printing an empty listing. Pinned in Task 1, tests 6 and 7.
5. **Arguments in another order** (`--out shots 07-murals`) or missing: parse correctly or fail with usage, never save to a file named `shots`. Pinned in Task 1, test 9.

---

### Task 1: Snapshot helper

**Files:**
- Modify: `scripts/devWait.mjs` (the `parseScreenText` function)
- Create: `scripts/devSnapshot.mjs`
- Create: `scripts/devSnapshot.test.mjs`
- Create: `scripts/dev-snapshot.mjs`
- Modify: `package.json` (`scripts`)

**Interfaces:**
- Consumes: `readScreenText(serial)` from `scripts/devWait.mjs` (returns the dump XML, or `""` on failure); `androidEnv()` from `scripts/androidSdk.mjs`; `worktreeIdentity(repoRoot)` from `scripts/devHost.mjs`; `deviceHolders`, `readRegistry`, `registryPath` from `scripts/devRegistry.mjs`.
- Produces:
  - `decodeEntities(value: string): string`, exported from `scripts/devWait.mjs`.
  - From `scripts/devSnapshot.mjs`: `parseDensity(output: string): number`; `parseHierarchy(xml: string): Node[]` where `Node = { text, desc, clickable, enabled, bounds: [x1, y1, x2, y2], children: Node[] }`; `formatListing({ name, pngPath, xml, density }): string`; `takeSnapshot(serial, name, outDir, { exec?, read? }): string`; `parseSnapshotArgs(argv: string[]): { name, outDir }`.
  - CLI: `node scripts/dev-snapshot.mjs <name> --out <dir>` (also `npm run dev:snapshot -- <name> --out <dir>`). Task 3's agent calls the `node` form.

- [ ] **Step 1: Write the failing tests**

Create `scripts/devSnapshot.test.mjs`:

```js
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { formatListing, parseDensity, parseSnapshotArgs, takeSnapshot } from "./devSnapshot.mjs";

const SCREEN = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<hierarchy rotation="0">',
  '<node text="" content-desc="" clickable="false" enabled="true" bounds="[0,0][1080,2400]">',
  '<node text="Murals" content-desc="" clickable="false" enabled="true" bounds="[40,100][300,160]" />',
  '<node text="" content-desc="Back" clickable="true" enabled="true" bounds="[0,100][43,143]" />',
  '<node text="" content-desc="" clickable="true" enabled="true" bounds="[40,200][1040,300]">',
  '<node text="Summer reads" content-desc="" clickable="false" enabled="true" bounds="[60,210][600,250]" />',
  '<node text="12 books" content-desc="" clickable="false" enabled="true" bounds="[60,250][600,290]" />',
  '<node text="" content-desc="Delete Summer reads" clickable="true" enabled="true" bounds="[960,220][1040,300]" />',
  "</node>",
  '<node text="" content-desc="" clickable="true" enabled="true" bounds="[0,2300][44,2344]" />',
  '<node text="Save" content-desc="" clickable="true" enabled="false" bounds="[40,400][1040,500]" />',
  '<node text="Hidden" content-desc="" clickable="true" enabled="true" bounds="[0,0][0,0]" />',
  "</node>",
  "</hierarchy>",
].join("");

test("formatListing lists taps with centre, label and size, and text outside them", () => {
  assert.equal(
    formatListing({ name: "07-murals", pngPath: "out/07-murals.png", xml: SCREEN, density: 160 }),
    [
      "07-murals · 1080×2400dp · saved out/07-murals.png",
      '  · "Murals"',
      '  tap 22,122  desc="Back"  43×43dp  ⚠ <44dp',
      '  tap 540,250  "Summer reads · 12 books"  1000×100dp',
      '  tap 1000,260  desc="Delete Summer reads"  80×80dp',
      "  tap 22,2322  (no label)  44×44dp",
      '  tap 540,450  "Save"  1000×100dp  (disabled)',
    ].join("\n"),
  );
});

test("formatListing converts pixels to dp and flags just under 44dp, never printing 44 when flagged", () => {
  const xml =
    '<hierarchy><node text="" bounds="[0,0][1080,2400]">' +
    '<node text="A" clickable="true" bounds="[0,0][115,200]" />' +
    '<node text="B" clickable="true" bounds="[200,0][316,200]" />' +
    "</node></hierarchy>";
  assert.equal(
    formatListing({ name: "x", pngPath: "x.png", xml, density: 420 }),
    ["x · 411×914dp · saved x.png", '  tap 58,100  "A"  43×76dp  ⚠ <44dp', '  tap 258,100  "B"  44×76dp'].join("\n"),
  );
});

test("formatListing decodes entities, keeps each label on one line, and clips long labels", () => {
  const long = "a".repeat(100);
  const xml =
    '<hierarchy><node text="" bounds="[0,0][160,160]">' +
    '<node text="Can&apos;t reach&#10;the server" clickable="true" bounds="[0,0][100,100]" />' +
    `<node text="${long}" bounds="[0,100][100,150]" />` +
    "</node></hierarchy>";
  const rows = formatListing({ name: "x", pngPath: "x.png", xml, density: 160 }).split("\n");
  assert.equal(rows[1], `  tap 50,50  "Can't reach the server"  100×100dp`);
  assert.equal(rows[2], `  · "${"a".repeat(59)}…"`);
  assert.equal(rows.length, 3);
});

test("formatListing survives an empty dump and a stray closing tag", () => {
  assert.equal(formatListing({ name: "x", pngPath: "x.png", xml: '<hierarchy rotation="0"></hierarchy>', density: 420 }), "x · 0×0dp · saved x.png");
  const stray = '<hierarchy></node><node text="Hi" bounds="[0,0][160,160]" /></hierarchy>';
  assert.equal(formatListing({ name: "x", pngPath: "x.png", xml: stray, density: 160 }), 'x · 160×160dp · saved x.png\n  · "Hi"');
});

test("parseDensity prefers the override and rejects anything else", () => {
  assert.equal(parseDensity("Physical density: 420\n"), 420);
  assert.equal(parseDensity("Physical density: 420\nOverride density: 480\n"), 480);
  assert.throws(() => parseDensity("error: no devices/emulators found"), /unexpected `wm density` output/);
});

function fakeAdb(calls) {
  return (command, args) => {
    calls.push([command, ...args].join(" "));
    if (args.includes("screencap")) return Buffer.from("png-bytes");
    if (args.includes("density")) return "Physical density: 160\n";
    return "";
  };
}

test("takeSnapshot saves and shrinks the screenshot, and retries one empty dump", () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-snapshot-"));
  const calls = [];
  const dumps = ["", SCREEN];
  const output = takeSnapshot("emulator-5554", "07-murals", dir, { exec: fakeAdb(calls), read: () => dumps.shift() });
  const pngPath = join(dir, "07-murals.png");
  assert.equal(readFileSync(pngPath, "utf8"), "png-bytes");
  assert.deepEqual(calls, [
    "adb -s emulator-5554 exec-out screencap -p",
    `sips -Z 1200 ${pngPath}`,
    "adb -s emulator-5554 shell wm density",
  ]);
  assert.equal(output.split("\n")[0], `07-murals · 1080×2400dp · saved ${pngPath}`);
  assert.equal(dumps.length, 0);
});

test("takeSnapshot keeps the screenshot and says so when the dump fails twice", () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-snapshot-"));
  const output = takeSnapshot("emulator-5554", "02-splash", dir, { exec: fakeAdb([]), read: () => "" });
  assert.equal(output, `02-splash · dump failed — screenshot only · saved ${join(dir, "02-splash.png")}`);
});

test("takeSnapshot lets a failed screencap propagate", () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-snapshot-"));
  const exec = () => {
    throw new Error("adb: device 'emulator-5554' not found");
  };
  assert.throws(() => takeSnapshot("emulator-5554", "x", dir, { exec, read: () => SCREEN }), /not found/);
});

test("parseSnapshotArgs takes the name and --out in either order and rejects a missing one", () => {
  assert.deepEqual(parseSnapshotArgs(["07-murals", "--out", "shots"]), { name: "07-murals", outDir: "shots" });
  assert.deepEqual(parseSnapshotArgs(["--out", "shots", "07-murals"]), { name: "07-murals", outDir: "shots" });
  assert.throws(() => parseSnapshotArgs(["07-murals"]), /usage/);
  assert.throws(() => parseSnapshotArgs(["--out", "shots"]), /usage/);
  assert.throws(() => parseSnapshotArgs(["07-murals", "--out"]), /usage/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/devSnapshot.test.mjs`
Expected: FAIL with `Cannot find module '…/scripts/devSnapshot.mjs'`.

- [ ] **Step 3: Extract `decodeEntities` in `scripts/devWait.mjs`**

Replace the whole `parseScreenText` function (keep the comment block above it, which explains why entities are decoded) with:

```js
export function decodeEntities(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

export function parseScreenText(xml) {
  return [...xml.matchAll(/text="([^"]*)"/g)].map((match) => decodeEntities(match[1])).filter((text) => text !== "");
}
```

Numeric entities are decoded first so that `&amp;#10;` stays the literal text `&#10;`.

- [ ] **Step 4: Write `scripts/devSnapshot.mjs`**

```js
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { androidEnv } from "./androidSdk.mjs";
import { decodeEntities, readScreenText } from "./devWait.mjs";

const MIN_TARGET_DP = 44;
const LABEL_LIMIT = 60;

export function parseDensity(output) {
  const match = output.match(/Override density:\s*(\d+)/) ?? output.match(/Physical density:\s*(\d+)/);
  if (!match) throw new Error(`unexpected \`wm density\` output: ${output.trim()}`);
  return Number(match[1]);
}

function readAttributes(source) {
  const attributes = {};
  for (const [, key, value] of source.matchAll(/([\w-]+)="([^"]*)"/g)) attributes[key] = decodeEntities(value);
  return attributes;
}

export function parseHierarchy(xml) {
  const root = { children: [] };
  const stack = [root];
  for (const [tag, source, selfClosing] of xml.matchAll(/<node\b([^>]*?)(\/?)>|<\/node>/g)) {
    if (tag === "</node>") {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attributes = readAttributes(source);
    const node = {
      text: attributes.text ?? "",
      desc: attributes["content-desc"] ?? "",
      clickable: attributes.clickable === "true",
      enabled: attributes.enabled !== "false",
      bounds: attributes.bounds?.match(/\d+/g)?.map(Number) ?? [0, 0, 0, 0],
      children: [],
    };
    stack.at(-1).children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root.children;
}

const toDp = (px, density) => (px * 160) / density;

function clip(value) {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > LABEL_LIMIT ? `${flat.slice(0, LABEL_LIMIT - 1)}…` : flat;
}

function innerText(node) {
  return [node.text, ...node.children.filter((child) => !child.clickable).flatMap(innerText)].filter(Boolean);
}

function tapLabel(node) {
  if (node.desc) return `desc="${clip(node.desc)}"`;
  const texts = innerText(node);
  return texts.length ? `"${clip(texts.join(" · "))}"` : "(no label)";
}

function tapRow(node, density) {
  const [x1, y1, x2, y2] = node.bounds;
  const width = toDp(x2 - x1, density);
  const height = toDp(y2 - y1, density);
  const small = width < MIN_TARGET_DP || height < MIN_TARGET_DP ? "  ⚠ <44dp" : "";
  const disabled = node.enabled ? "" : "  (disabled)";
  const centre = `${Math.round((x1 + x2) / 2)},${Math.round((y1 + y2) / 2)}`;
  return `  tap ${centre}  ${tapLabel(node)}  ${Math.floor(width)}×${Math.floor(height)}dp${small}${disabled}`;
}

function collectRows(node, density, insideTap, rows) {
  const [x1, y1, x2, y2] = node.bounds;
  if (x2 <= x1 || y2 <= y1) return;
  if (node.clickable) rows.push(tapRow(node, density));
  else if (!insideTap && (node.text || node.desc)) rows.push(`  · ${node.text ? `"${clip(node.text)}"` : `desc="${clip(node.desc)}"`}`);
  for (const child of node.children) collectRows(child, density, insideTap || node.clickable, rows);
}

export function formatListing({ name, pngPath, xml, density }) {
  const roots = parseHierarchy(xml);
  const [x1, y1, x2, y2] = roots[0]?.bounds ?? [0, 0, 0, 0];
  const header = `${name} · ${Math.round(toDp(x2 - x1, density))}×${Math.round(toDp(y2 - y1, density))}dp · saved ${pngPath}`;
  const rows = [];
  for (const root of roots) collectRows(root, density, false, rows);
  return [header, ...rows].join("\n");
}

function runTool(command, args, options) {
  return execFileSync(command, args, { env: { ...process.env, ...androidEnv() }, maxBuffer: 64 * 1024 * 1024, ...options });
}

export function takeSnapshot(serial, name, outDir, { exec = runTool, read = readScreenText } = {}) {
  const adb = (args, options) => exec("adb", ["-s", serial, ...args], options);
  mkdirSync(outDir, { recursive: true });
  const pngPath = join(outDir, `${name}.png`);
  writeFileSync(pngPath, adb(["exec-out", "screencap", "-p"]));
  exec("sips", ["-Z", "1200", pngPath], { stdio: "ignore" });
  const density = parseDensity(adb(["shell", "wm", "density"], { encoding: "utf8" }));
  const xml = read(serial) || read(serial);
  if (!xml) return `${name} · dump failed — screenshot only · saved ${pngPath}`;
  return formatListing({ name, pngPath, xml, density });
}

export function parseSnapshotArgs(argv) {
  const outFlag = argv.indexOf("--out");
  const outDir = outFlag === -1 ? undefined : argv[outFlag + 1];
  const name = argv.find((arg, index) => !arg.startsWith("--") && (outFlag === -1 || index !== outFlag + 1));
  if (!name || !outDir || outDir.startsWith("--")) throw new Error("usage: npm run dev:snapshot -- <name> --out <dir>");
  return { name, outDir };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test scripts/devSnapshot.test.mjs scripts/devWait.test.mjs`
Expected: PASS, 15 tests (9 new, 6 existing `devWait` tests), 0 failures.

- [ ] **Step 6: Write the CLI `scripts/dev-snapshot.mjs`**

```js
#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { worktreeIdentity } from "./devHost.mjs";
import { deviceHolders, readRegistry, registryPath } from "./devRegistry.mjs";
import { parseSnapshotArgs, takeSnapshot } from "./devSnapshot.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

try {
  const { name, outDir } = parseSnapshotArgs(process.argv.slice(2));
  const { worktree, branch } = worktreeIdentity(repoRoot);
  const lease = deviceHolders(readRegistry(registryPath(repoRoot))).find((holder) => holder.worktree === worktree);
  if (!lease?.serial) throw new Error(`${branch} holds no emulator — run \`node scripts/dev-emulator.mjs\` first.`);
  console.log(takeSnapshot(lease.serial, name, resolve(outDir)));
} catch (error) {
  console.error(`[dev-snapshot] ${error.message}`);
  process.exitCode = 1;
}
```

Then add to the root `package.json` `scripts`, right after `"dev:wait"`:

```json
"dev:snapshot": "node scripts/dev-snapshot.mjs",
```

- [ ] **Step 7: Check the CLI's two failure paths without a device**

Run: `node scripts/dev-snapshot.mjs; echo "exit $?"`
Expected: `[dev-snapshot] usage: npm run dev:snapshot -- <name> --out <dir>` and `exit 1`.

Run: `node scripts/dev-snapshot.mjs 01-test --out "$(mktemp -d)"; echo "exit $?"`
Expected (this worktree holds no emulator): `[dev-snapshot] <branch> holds no emulator — run \`node scripts/dev-emulator.mjs\` first.` and `exit 1`. If it instead prints a listing, this worktree holds a lease; that is fine, and the listing is the success path.

- [ ] **Step 8: Run the whole root script suite**

Run: `npm run test:scripts`
Expected: PASS, 0 failures.

- [ ] **Step 9: Commit**

```bash
git add scripts/devWait.mjs scripts/devSnapshot.mjs scripts/devSnapshot.test.mjs scripts/dev-snapshot.mjs package.json && git commit -q -m "Add dev:snapshot: one call for a shrunk screenshot and a control listing

The beta-tester agent sweeps the whole app, and each screenshot it reads
costs context. dev:snapshot prints the screen's controls as text (tap
centre, label, dp size) so the agent navigates without opening the image,
and flags clickables under DESIGN.md's 44dp floor. A clickable's label
comes from its children's text because React Native puts button text on
child nodes; one with no text and no content-desc prints (no label), which
is also a TalkBack gap. decodeEntities moves out of parseScreenText and
learns numeric entities, since uiautomator writes newlines as &#10;.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git log --oneline -1
```

---

### Task 2: Real-screen check of the listing (main session → `device-checker`)

No code. This catches a listing that is useless on real React Native output (for example most buttons `(no label)`, or tap centres that miss) before the expensive sweep.

**Interfaces:**
- Consumes: `node scripts/dev-snapshot.mjs <name> --out <dir>` from Task 1.
- Produces: a go / no-go for Task 3, plus `01-library.xml`, a real dump to add as a test case if the listing needs a fix.

- [ ] **Step 1: Check the lease once**

Run: `node scripts/dev-status.mjs --json` and read `devices[]`. If another worktree holds both devices, tell the user and wait; this check gates the sweep. Do not poll.

- [ ] **Step 2: Dispatch `device-checker`**

`subagent_type: "device-checker"`, prompt:

```
Worktree: <absolute worktree path>. Screenshots directory: <scratchpad>/snapshot-check.
This is a check of a new script, scripts/dev-snapshot.mjs, on a real screen. Follow emulator-verify as usual (no --reset needed).

1. Wait for the Library tab: `npm run dev:wait -- "Library" --timeout 120`.
2. Run `node scripts/dev-snapshot.mjs 01-library --out <screenshots dir>` and paste its full stdout in your report.
3. Save the raw dump next to it: `adb -s <serial> shell cat /sdcard/ui.xml > <screenshots dir>/01-library.xml`.
4. Read 01-library.png. For each of three rows — the first book card, one tab-bar button, one header icon button — tap the printed centre with `adb -s <serial> shell input tap <x> <y>` and say whether that control opened what its label names. Go back after each.
5. Count the `tap` rows that print `(no label)` and say which visible controls they are.
6. Run `adb -s <serial> logcat -d -s ReactNativeJS | tail -20` and paste the output, or say it was empty.
7. Release as usual.

Report: the stdout from step 2, pass/fail for each of the three taps, the (no label) list, the logcat output, and whether the PNG reads clearly at its shrunk size.
```

- [ ] **Step 3: Decide**

- **Go** when all three taps hit their named control and text buttons carry their text. `(no label)` on genuine icon-only buttons is expected; those are real findings.
- **No-go** when text buttons print `(no label)` or taps miss. Then send the implementer back to Task 1 with `01-library.xml`: add the failing case as a new test, adjust `tapLabel`/`collectRows` until it passes, and re-run this task.
- Note for Task 4 whether logcat had any `ReactNativeJS` lines. The agent falls back to `metro.log` on its own either way.

---

### Task 3: The `beta-tester` agent, gitignore, and dispatch row

**Files:**
- Create: `.claude/agents/beta-tester.md`
- Modify: `.gitignore` (append)
- Modify: `CLAUDE.md` (dispatch table, after the "User wants emulator screenshots" row)

**Interfaces:**
- Consumes: `node scripts/dev-snapshot.mjs <name> --out <dir>` (Task 1); `.claude/skills/emulator-verify/SKILL.md`; `scripts/dev-emulator.mjs --reset`; `scripts/fixtures/account.json`.
- Produces: `subagent_type: "beta-tester"`, taking a worktree path and an output directory and returning the report path plus its Summary section.

- [ ] **Step 1: Write `.claude/agents/beta-tester.md`**

````markdown
---
name: beta-tester
description: Exploratory whole-app sweep of the Scripta mobile app on the Android emulator. Uses every screen and control like a curious beta tester, tries the edges, and writes a ranked report of bugs, UX friction, design-system breaches, accessibility and copy problems, with screenshots. Give it the worktree path and an output directory. Never fixes anything.
tools: Bash, Read, Write
model: sonnet
---

You are a beta tester for Scripta, a personal e-book library app. Use the whole mobile app the way a curious reader would, push on the edges, and report what is broken, confusing or off-system. You never fix anything: no source edits, commits or pushes.

## Setup

1. Read `.claude/skills/emulator-verify/SKILL.md` in the worktree you were given. Follow it for the lease check, starting the stack, the adb driving rules and the release. A sweep is optional work: if every device is held by another worktree, stop and report "emulator occupied".
2. Start from clean fixture data: `node scripts/dev-emulator.mjs --reset`. Take the serial and Metro port from `node scripts/dev-status.mjs --json`, as the skill says.
3. Clear the device log and note where Metro's log ends. Shell variables do not survive between your commands, so keep the number:
   ```bash
   adb -s <serial> logcat -c
   wc -c < "$(node -p 'require("node:os").tmpdir()')/scripta-dev-emulator/metro.log"
   ```
4. Read `DESIGN.md` once. It is the standard for design-system, accessibility and copy findings. Read a spec under `docs/superpowers/specs/` only when a behaviour looks wrong, to check whether it is intended.
5. Build the coverage list, every route the app has:
   ```bash
   find mobile/src/app -name '*.tsx' ! -name '_layout.tsx' ! -path '*/dashboard/*' | sort
   ```
   Write `report.md` in the output directory now, from the template below, with every route "not reached".

## Looking at a screen

```bash
node scripts/dev-snapshot.mjs <NN>-<screen>-<state> --out <output dir>
```

`NN` is a running two-digit counter. It saves a shrunk screenshot and prints the screen's controls:

```
07-murals · 411×914dp · saved <dir>/07-murals.png
  · "Murals"
  tap 44,132  desc="Back"  36×36dp  ⚠ <44dp
  tap 540,1180  "Summer reads · 12 books"  379×96dp
  tap 1000,1190  (no label)  48×48dp
```

Navigate from the listing: `adb -s <serial> shell input tap <x> <y>` with the printed centre. Open the PNG with Read on a screen's first visit and whenever something visual changed, not after every tap; the listing is enough to navigate. "dump failed — screenshot only" means read the PNG instead.

## Sweep

You may create, edit and delete anything through the app; the run started from `--reset`. Never write `backend/data/`, a `.sqlite` file or the fixtures directly.

In this order:

1. **First run.** Sign out from Settings. On the login screen choose "Sign up" and create `beta-<unix time>@local.test` with any username and password; this is the local dev backend. Go through choose-username and welcome-avatar, then look at the empty library, My shelf, Murals and Games.
2. **Dev account.** Sign out, then cold restart: `adb -s <serial> shell am force-stop host.exp.exponent`, then open `exp://127.0.0.1:<metro>`. Dev auto-login signs in `scripta-dev@local.test` with 24 books. If it lands on the login screen instead, sign in with the username and password in `scripts/fixtures/account.json`. Then each tab (Home, My shelf, Games, Murals, Settings) and every screen they lead to. Create one of each thing the app makes (a mural, a collection, a tier list, a quiz, a library share link, a mural share link) so the next step has something to open.
3. **Public routes by deep link** (`exp://127.0.0.1:<metro>/--/<route>`): the share links from step 2, `vote/<code>` and `play/<code>` for the tier list and quiz, `arena/<id>`, and a route that does not exist.

On every screen, use each control once. Then try the edges that apply:

- empty input, 300-character input, emoji
- double-tap on anything that submits
- Android back in the middle of an action, and right after one
- destructive actions: is there a confirm, does it say what will be lost, is there undo
- what a new user would not understand: unexplained icons, dead ends, no way back, actions with no visible result

## What counts as a finding

Severity:

- **blocker**: a core task cannot be done; a crash or red screen; data lost.
- **major**: works only with a workaround, shows wrong data, or an error is swallowed (the action silently does nothing).
- **minor**: works but is confusing, inconsistent, slow to give feedback, or breaks a DESIGN.md rule.
- **polish**: cosmetic.

Category: bug · UX friction · design-system breach · accessibility · copy.

Before reporting:

- Reproduce a bug a second time. A visual or copy finding needs one clear screenshot.
- Run the skill's "suspect the harness first" checks before blaming the app.
- Check every label you quote in the PNG itself, zoomed in, not in the listing.
- A `⚠ <44dp` row is a candidate. Report it only after `rg -n hitSlop` on the component that renders it finds none.
- A `(no label)` tap is an accessibility finding (TalkBack cannot name it). Confirm with `rg` that the component sets no `accessibilityLabel`.
- One cause seen on several screens is one finding that lists every screen.

Append each finding to `report.md` the moment it is confirmed, and update its route in the coverage table, so nothing is lost if your context is compacted. Number findings in the order found; rank them at the end.

## Finish

1. JavaScript errors:
   ```bash
   adb -s <serial> logcat -d -s ReactNativeJS:E
   ```
   If `adb -s <serial> logcat -d -s ReactNativeJS` prints nothing at all, JS logs are not reaching logcat. Read Metro's log from the byte count you noted instead:
   ```bash
   tail -c +<count + 1> "$(node -p 'require("node:os").tmpdir()')/scripta-dev-emulator/metro.log" | rg -i "error|warn"
   ```
   Deduplicate and count.
2. Rewrite `report.md` in final form: summary at the top, findings ranked by severity, then by how central the screen is.
3. `npm run dev:release`, whatever happened.
4. Reply with the report's path and its Summary section, nothing else.

## Report template

```markdown
# Beta sweep, <YYYY-MM-DD HH:MM>, <branch> @ <short sha>

## Summary
<n> blocker · <n> major · <n> minor · <n> polish. Fix first: #<a>, #<b>, #<c>, one line each on why.

## Findings

### #<n> <one-line title>
- **Severity / category:** major · UX friction
- **Screen:** <name> (`<route>`)
- **Steps:** 1. … 2. … 3. …
- **Expected:** … (cite the DESIGN.md rule or spec line when one applies)
- **Actual:** …
- **Screenshot:** `<file>.png`

## JavaScript errors
| Count | Message (first line) |
|---|---|

## Coverage
| Route | Status | Note |
|---|---|---|
| `(app)/(home)/index.tsx` | visited / partial / not reached | why, if not visited |

## Harness notes and leftover state
- Anything blamed on the harness, and how it was confirmed.
- Throwaway account: `beta-<unix time>@local.test`.
- Fixture data is dirty; the next pass that needs clean data runs `node scripts/dev-emulator.mjs --reset`.
```
````

- [ ] **Step 2: Ignore sweep output**

Append one line to the end of `.gitignore`:

```
/beta-tests/
```

- [ ] **Step 3: Add the dispatch row to `CLAUDE.md`**

Insert directly below the line that starts `| User wants emulator screenshots |`:

```
| User asks for a beta test or UX sweep of the app | `beta-tester`, output dir `$(git rev-parse --path-format=absolute --git-common-dir)/../beta-tests/<YYYY-MM-DD-HHMM>/`; send its `report.md` with SendUserFile, then triage it with the user |
```

- [ ] **Step 4: Verify**

Run: `npm run check:agents && git diff --check && head -5 .claude/agents/beta-tester.md`
Expected: check:agents passes, no whitespace errors, and the frontmatter shows `name: beta-tester`, `tools: Bash, Read, Write`, `model: sonnet`.

- [ ] **Step 5: Commit**

```bash
git add .claude/agents/beta-tester.md .gitignore CLAUDE.md && git commit -q -m "Add the beta-tester agent: whole-app exploratory sweep on the emulator

Nothing used the app the way a reader does; UX problems surfaced only on
the user's own phone. beta-tester sweeps every route under mobile/src/app
(first run on a throwaway account, then the 24-book dev account, then
share and game deep links), judges against DESIGN.md, and appends each
confirmed finding to report.md as it goes so a compacted context loses
nothing. It mutates fixture data freely after a --reset instead of undoing
by hand like device-checker: each worktree has its own backend/data/dev.
Reports go to beta-tests/ in the main checkout so they outlive the
worktree.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git log --oneline -1
```

---

### Task 4: Acceptance sweep (main session)

No code unless the review calls for prompt tuning.

**Interfaces:**
- Consumes: `subagent_type: "beta-tester"` (Task 3).
- Produces: the first `report.md`, reviewed with the user.

- [ ] **Step 1: Make sure the agent type is loaded**

Saved agents load at session start. If `beta-tester` is not in the Agent tool's list of agent types, stop here and give the user a paste-ready first message for a fresh session in this worktree that starts at Task 4.

- [ ] **Step 2: Check the lease once**

Run: `node scripts/dev-status.mjs --json`. If both devices are held by other worktrees, tell the user and wait. Do not poll.

- [ ] **Step 3: Dispatch the sweep**

`subagent_type: "beta-tester"`, `run_in_background: true`, prompt:

```
Worktree: <absolute worktree path>.
Output directory: <output of `git rev-parse --path-format=absolute --git-common-dir`>/../beta-tests/<YYYY-MM-DD-HHMM>/
Run a full sweep.
```

- [ ] **Step 4: Deliver**

When it finishes, send `<output dir>/report.md` with SendUserFile. Note the run's `subagent_tokens` from the task notification for the cost line in Step 6.

- [ ] **Step 5: Spot-check before trusting it**

- Pick three findings (the top one, one minor, one accessibility) and Read their screenshots: does the image show what the finding claims?
- Check the coverage table: every route from the `find` listed, and a reason for each one not reached.
- Check the leftover-state section names the throwaway account.

- [ ] **Step 6: Review with the user**

Present the summary, the spot-check result, the token count, and the coverage gaps. Ask which findings are real and worth fixing.

- If findings are wrong or shallow, edit `.claude/agents/beta-tester.md` to target the miss (for example a rule the agent ignored) and commit with the reason in the message.
- If the cost is too high, the spec's mitigation is splitting the sweep into areas run one after another. That is a new design decision for the user, not a silent change.
- Confirmed findings become ordinary plan tasks in later work. The tester does not fix them.

- [ ] **Step 7: Ship when the user says so**

Use the `ship` skill. The PR carries Task 1 and Task 3's commits plus the spec and this plan.
