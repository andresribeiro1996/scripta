# Codex second review, verify gate and round log — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A verify gate every task runs once, a read-only Codex review of plans and branches, and a one-line-per-run log of both.

**Architecture:** Two CLIs under `scripts/` (`gate.mjs`, `codex-review.mjs`) over three pure modules (`gateCore.mjs`, `runLog.mjs`, `codexReview.mjs`), following the repo's `devWait.mjs` / `dev-wait.mjs` split: pure logic tested with `node --test`, thin process and git glue untested. Reports go to the worktree's gitignored `.superpowers/runs/<branch>/`; the round log goes to the main checkout's `.superpowers/rounds.jsonl`. Agent files, CLAUDE.md and the ship skill then route work through them.

**Tech Stack:** Node 26 ESM, stdlib only (`node:child_process`, `node:fs`, `node:test`), Codex CLI 0.154 (`codex exec`).

**Spec:** `docs/superpowers/specs/2026-10-16-codex-second-review-design.md`

## Global Constraints

- Stdlib only; no new dependencies.
- Test files sit directly in `scripts/` as `*.test.mjs`: `npm run test:scripts` is `node --test scripts/*.test.mjs` and does not recurse.
- No comments in code (root `AGENTS.md`).
- Reports: `<worktree>/.superpowers/runs/<branch with every / replaced by ->/`. Round log: `<main checkout>/.superpowers/rounds.jsonl`, where the main checkout is `dirname "$(git rev-parse --path-format=absolute --git-common-dir)"`.
- Codex always runs `-s read-only`.
- Exit codes: `gate.mjs` 0 pass / 1 fail; `codex-review.mjs` 0 `CODEX: PASS` / 1 `CODEX: FAIL` / 2 `CODEX: ERROR`.
- A Codex error never reads as a pass.

## Review Focus

- A plan `Files:` line with inline code or a parenthetical file (`` (add to `backend/package.json`'s `test` list) ``) — the file counts as allowed, the code doesn't. Test in Task 2.
- A task that deletes files lists them on `- Delete:` lines, several per line — they count as allowed. Test in Task 2.
- A change only in `packages/shared` must run backend, frontend and mobile checks too, since they read its `dist/`. Test in Task 2.
- Codex exits 0 but leaves empty or malformed output, or says `pass` while listing a blocking finding — the result is `ERROR` or `FAIL`, never `PASS`. Tests in Task 4.
- Two branches named `claude/a` and `claude/b`, or a re-run on the same branch — reports never collide and round numbers count per kind. Tests in Task 3.

---

### Task 1: Spike — record a real Codex run (main session, not an implementer)

**Files:**
- Create: `scripts/codex/findings.schema.json`
- Create: `scripts/fixtures/codex-exec.jsonl`

**Interfaces:**
- Produces: `scripts/codex/findings.schema.json` (used by Task 5), `scripts/fixtures/codex-exec.jsonl` (used by Task 4's tests), and the event field names for token usage and model that Task 4's `codexUsage` reads.

- [ ] **Step 1: Check the Codex global instructions are clean**

Run: `wc -c < ~/.codex/AGENTS.md`
Expected: `0`. Anything else: stop and ask the user to run `: > ~/.codex/AGENTS.md && rm ~/.codex/RTK.md ~/.codex/AGENTS.md.pre-rtk.bak` — the file told Codex to prefix commands with the uninstalled `rtk`.

- [ ] **Step 2: Write the findings schema**

`scripts/codex/findings.schema.json`:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["verdict", "findings"],
  "properties": {
    "verdict": { "type": "string", "enum": ["pass", "fail"] },
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["severity", "file", "line", "summary", "scenario"],
        "properties": {
          "severity": { "type": "string", "enum": ["blocking", "should-fix", "follow-up"] },
          "file": { "type": "string" },
          "line": { "type": "integer" },
          "summary": { "type": "string" },
          "scenario": { "type": "string" }
        }
      }
    }
  }
}
```

- [ ] **Step 3: Run Codex read-only from this worktree**

```bash
mkdir -p .superpowers && codex exec -s read-only -C "$PWD" --json --ephemeral --output-schema scripts/codex/findings.schema.json -o .superpowers/spike.json - > scripts/fixtures/codex-exec.jsonl <<'EOF'
Run these two commands and change nothing: `git diff --stat origin/main...HEAD` and `git status --porcelain`. Report one finding per command with severity "follow-up", file "spike", line 1, summary set to the command, and scenario set to its first line of output or the exact error it printed. Verdict "pass".
EOF
```

Expected: exit 0, `.superpowers/spike.json` holds JSON matching the schema.

- [ ] **Step 4: Read the result**

Run: `cat .superpowers/spike.json && rg -o '"type":"[^"]+"' scripts/fixtures/codex-exec.jsonl | sort | uniq -c && rg -n 'usage|"model"' scripts/fixtures/codex-exec.jsonl`

Expected: both scenarios show real git output, not a sandbox or permission error. Note where token usage sits (Task 4 assumes events carrying `usage: { input_tokens, cached_input_tokens, output_tokens }`) and whether any event has a top-level `model` string.

- If git failed inside the sandbox: stop. Update the spec and Tasks 4–5 so branch mode runs `git diff origin/main...HEAD` itself and puts the diff in the prompt, then continue.
- If usage or model sit under other names: change `codexUsage` and its synthetic test in Task 4 to the recorded names before dispatching Task 4.

- [ ] **Step 5: Check the fixture holds no credentials**

Run: `rg -in 'bearer|sk-[a-z0-9]|api[_-]?key|authorization' scripts/fixtures/codex-exec.jsonl`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add scripts/codex/findings.schema.json scripts/fixtures/codex-exec.jsonl && git commit -F - <<'EOF'
Record a read-only Codex run as a fixture, with the findings schema

codex-review.mjs reads token usage from Codex's --json events and the
review from --output-schema; this run pins both shapes and shows git
works inside the read-only sandbox from a worktree.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: `gateCore.mjs` — what to check and what's in scope

**Files:**
- Create: `scripts/gateCore.mjs`
- Test: `scripts/gateCore.test.mjs`

**Interfaces:**
- Produces (all named exports of `scripts/gateCore.mjs`):
  - `parseGateArgs(argv: string[]) → { plan?: string, task?: number }` — throws when only one of `--plan`/`--task` is given, a flag lacks a value, or `--task` isn't digits.
  - `parseVerifyCommands(text: string) → { cwd: string, command: string }[]`
  - `agentsFilesFor(changedFiles: string[]) → string[]` — repo-relative `AGENTS.md` paths, in the fixed order packages, backend, frontend, mobile, root.
  - `verifyCommands(agentsFiles: string[], readText: (path) => string) → { cwd, command }[]` — deduplicated, in order.
  - `taskFiles(planText: string, taskNumber: number) → string[]` — throws when the heading is missing or lists no files.
  - `outOfScope(changedFiles: string[], allowedFiles: string[]) → string[]`
  - `tail(text: string, count: number) → string`
  - `gatePassed({ results, scope }) → boolean`
  - `renderGateReport({ round: number, sha: string, results: { cwd, command, ok: boolean, seconds: number, log: string, tail: string }[], scope: null | { task: number, outside: string[] } }) → string`

- [ ] **Step 1: Write the failing tests**

`scripts/gateCore.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  agentsFilesFor,
  gatePassed,
  outOfScope,
  parseGateArgs,
  parseVerifyCommands,
  renderGateReport,
  tail,
  taskFiles,
  verifyCommands,
} from "./gateCore.mjs";

const MOBILE_AGENTS = [
  "# Mobile",
  "",
  "## Commands",
  "",
  "- Run: `npm run mobile`",
  "- Verify: `npm run build --workspace @scripta/shared`",
  "- Verify: `npm run typecheck --workspace mobile`",
  "- Verify Expo configuration: `cd mobile && npx expo-doctor`",
  "- Run Maestro only when a device or emulator and test credentials are available.",
].join("\n");

const PLAN = [
  "### Task 1: Detect",
  "",
  "**Files:**",
  "- Create: `packages/shared/src/library/mojibake.ts`",
  '- Modify: `packages/shared/src/library/index.ts` (add `export * from "./mojibake.js";`)',
  "- Modify: `packages/shared/src/library/bookSearch.ts:109-127` (`mapOpenLibraryDoc`)",
  "- Create: `backend/src/x.test.ts` (add to `backend/package.json`'s `test` list)",
  "- Delete: `mobile/src/app/(app)/(murals)/_layout.tsx`, `mobile/src/Old.tsx`",
  "- Delete the `Mark as …` button.",
  "",
  "- [ ] **Step 1:** edit `frontend/src/notListed.ts`",
  "",
  "### Task 10: Later",
  "",
  "- Create: `frontend/src/ten.ts`",
  "",
  "### Task 2: Next",
  "",
  "- Create: `mobile/src/two.ts`",
].join("\n");

test("parseGateArgs takes --plan and --task together", () => {
  assert.deepEqual(parseGateArgs([]), { plan: undefined, task: undefined });
  assert.deepEqual(parseGateArgs(["--plan", "p.md", "--task", "3"]), { plan: "p.md", task: 3 });
  assert.throws(() => parseGateArgs(["--plan", "p.md"]), /go together/);
  assert.throws(() => parseGateArgs(["--plan", "--task", "3"]), /--plan needs a value/);
  assert.throws(() => parseGateArgs(["--plan", "p.md", "--task", "three"]), /task number/);
});

test("parseVerifyCommands reads every Verify line and splits a leading cd", () => {
  assert.deepEqual(parseVerifyCommands(MOBILE_AGENTS), [
    { cwd: ".", command: "npm run build --workspace @scripta/shared" },
    { cwd: ".", command: "npm run typecheck --workspace mobile" },
    { cwd: "mobile", command: "npx expo-doctor" },
  ]);
});

test("parseVerifyCommands takes the first backticked span, not a trailing note", () => {
  assert.deepEqual(parseVerifyCommands("- Verify: `npm run lint --workspace frontend` (oxlint)"), [
    { cwd: ".", command: "npm run lint --workspace frontend" },
  ]);
});

test("agentsFilesFor maps each file to the AGENTS.md that governs it", () => {
  assert.deepEqual(agentsFilesFor(["backend/src/app.ts", "backend/README.md"]), ["backend/AGENTS.md"]);
  assert.deepEqual(agentsFilesFor(["scripts/gate.mjs"]), ["AGENTS.md"]);
  assert.deepEqual(
    agentsFilesFor(["docs/x.md", ".claude/agents/a.md", "viewer/index.html", "exporter/export.py", "CLAUDE.md"]),
    [],
  );
});

test("a shared package change checks every consumer too", () => {
  assert.deepEqual(agentsFilesFor(["packages/shared/src/library/a.ts"]), [
    "packages/AGENTS.md",
    "backend/AGENTS.md",
    "frontend/AGENTS.md",
    "mobile/AGENTS.md",
  ]);
});

test("a root manifest checks every package and the root scripts", () => {
  assert.deepEqual(agentsFilesFor(["mobile/src/a.ts", "package-lock.json"]), [
    "packages/AGENTS.md",
    "backend/AGENTS.md",
    "frontend/AGENTS.md",
    "mobile/AGENTS.md",
    "AGENTS.md",
  ]);
});

test("verifyCommands runs each command once, in file order", () => {
  const files = {
    "packages/AGENTS.md": "- Verify: `npm run build --workspace @scripta/shared`\n- Verify: `npm test --workspace @scripta/shared`",
    "backend/AGENTS.md": "- Verify: `npm run build --workspace @scripta/shared`\n- Verify: `npm test --workspace backend`",
  };
  assert.deepEqual(
    verifyCommands(["packages/AGENTS.md", "backend/AGENTS.md"], (path) => files[path]).map(({ command }) => command),
    ["npm run build --workspace @scripta/shared", "npm test --workspace @scripta/shared", "npm test --workspace backend"],
  );
});

test("taskFiles reads file lines, keeps parenthetical files and drops code and line ranges", () => {
  assert.deepEqual(taskFiles(PLAN, 1), [
    "packages/shared/src/library/mojibake.ts",
    "packages/shared/src/library/index.ts",
    "packages/shared/src/library/bookSearch.ts",
    "backend/src/x.test.ts",
    "backend/package.json",
    "mobile/src/app/(app)/(murals)/_layout.tsx",
    "mobile/src/Old.tsx",
  ]);
});

test("taskFiles stops at the next task and tells Task 1 from Task 10", () => {
  assert.deepEqual(taskFiles(PLAN, 10), ["frontend/src/ten.ts"]);
  assert.deepEqual(taskFiles(PLAN, 2), ["mobile/src/two.ts"]);
});

test("taskFiles refuses a missing task or one with no files", () => {
  assert.throws(() => taskFiles(PLAN, 3), /no "### Task 3" heading/);
  assert.throws(() => taskFiles("### Task 1: Think\n\n- [ ] **Step 1:** decide", 1), /task 1 lists no files/);
});

test("taskFiles reads a real plan from this repo", () => {
  const plan = readFileSync(new URL("../docs/superpowers/plans/2026-10-15-catalog-mojibake.md", import.meta.url), "utf8");
  assert.ok(taskFiles(plan, 1).includes("packages/shared/src/library/bookSearch.ts"));
  assert.ok(taskFiles(plan, 3).includes("backend/package.json"));
  assert.ok(taskFiles(plan, 3).includes("backend/scripts/repair-mojibake.mjs"));
});

test("outOfScope lists changed files the task does not name", () => {
  assert.deepEqual(outOfScope(["a/b.ts", "a/c.ts", "docs/d.md"], ["a/b.ts", "docs/"]), ["a/c.ts"]);
});

test("tail keeps the last lines and ignores the trailing newline", () => {
  assert.equal(tail("1\n2\n3\n", 2), "2\n3");
  assert.equal(tail("only", 40), "only");
});

const PASSING = { cwd: ".", command: "npm test --workspace backend", ok: true, seconds: 12, log: "gate-r2-1.log", tail: "" };
const FAILING = { cwd: "mobile", command: "npx expo-doctor", ok: false, seconds: 30, log: "gate-r2-2.log", tail: "✖ Check failed" };

test("a passing report lists each check and ends PASS", () => {
  const report = renderGateReport({ round: 2, sha: "abc1234", results: [PASSING], scope: { task: 3, outside: [] } });
  assert.match(report, /^# Gate r2\n/);
  assert.match(report, /HEAD: abc1234/);
  assert.match(report, /- PASS `npm test --workspace backend` \(12s\)/);
  assert.match(report, /Scope: PASS — every changed file is in task 3's Files list/);
  assert.equal(report.trimEnd().split("\n").at(-1), "RESULT: PASS");
});

test("a failing check shows where it ran, its log and its tail, and fails the gate", () => {
  const report = renderGateReport({ round: 2, sha: "abc1234", results: [PASSING, FAILING], scope: null });
  assert.match(report, /- FAIL `npx expo-doctor` in `mobile\/` \(30s\) — full log: gate-r2-2.log/);
  assert.match(report, /```text\n✖ Check failed\n```/);
  assert.equal(report.trimEnd().split("\n").at(-1), "RESULT: FAIL");
});

test("a file outside the task fails the gate even when every check passes", () => {
  const scope = { task: 3, outside: ["frontend/src/x.ts"] };
  const report = renderGateReport({ round: 1, sha: "abc1234", results: [PASSING], scope });
  assert.match(report, /Scope: FAIL — not in task 3's Files list: `frontend\/src\/x.ts`/);
  assert.equal(report.trimEnd().split("\n").at(-1), "RESULT: FAIL");
  assert.equal(gatePassed({ results: [PASSING], scope }), false);
});

test("no plan means no scope check, and no checks to run is still a pass", () => {
  const report = renderGateReport({ round: 1, sha: "abc1234", results: [], scope: null });
  assert.match(report, /No checks apply to the changed files\./);
  assert.match(report, /Scope: not checked \(no --plan\)/);
  assert.equal(report.trimEnd().split("\n").at(-1), "RESULT: PASS");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/gateCore.test.mjs`
Expected: FAIL — `Cannot find module` for `./gateCore.mjs`.

- [ ] **Step 3: Implement**

`scripts/gateCore.mjs`:

```js
const AGENTS_ORDER = ["packages/AGENTS.md", "backend/AGENTS.md", "frontend/AGENTS.md", "mobile/AGENTS.md", "AGENTS.md"];
const APPS = ["backend", "frontend", "mobile"];
const ROOT_MANIFESTS = new Set(["package.json", "package-lock.json"]);
const FILE_LINE = /^- (Create|Modify|Test|Delete):/;

export function parseGateArgs(argv) {
  const value = (flag) => {
    const index = argv.indexOf(flag);
    if (index === -1) return undefined;
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) throw new Error(`${flag} needs a value.`);
    return next;
  };
  const plan = value("--plan");
  const task = value("--task");
  if ((plan === undefined) !== (task === undefined)) throw new Error("--plan and --task go together.");
  if (task !== undefined && !/^\d+$/.test(task)) throw new Error("--task takes a task number.");
  return { plan, task: task === undefined ? undefined : Number(task) };
}

export function parseVerifyCommands(text) {
  return text.split("\n").flatMap((line) => {
    const match = line.match(/^- Verify[^`]*`([^`]+)`/);
    if (!match) return [];
    const cd = match[1].match(/^cd\s+(\S+)\s+&&\s+(.+)$/);
    return [cd ? { cwd: cd[1], command: cd[2] } : { cwd: ".", command: match[1] }];
  });
}

function agentsFor(file) {
  if (ROOT_MANIFESTS.has(file)) return AGENTS_ORDER;
  const [top, ...rest] = file.split("/");
  if (rest.length === 0) return [];
  if (top === "packages") return ["packages/AGENTS.md", ...APPS.map((dir) => `${dir}/AGENTS.md`)];
  if (APPS.includes(top)) return [`${top}/AGENTS.md`];
  if (top === "scripts") return ["AGENTS.md"];
  return [];
}

export function agentsFilesFor(changedFiles) {
  const wanted = new Set(changedFiles.flatMap(agentsFor));
  return AGENTS_ORDER.filter((agents) => wanted.has(agents));
}

export function verifyCommands(agentsFiles, readText) {
  const seen = new Set();
  return agentsFiles.flatMap((file) => parseVerifyCommands(readText(file))).filter(({ cwd, command }) => {
    const key = `${cwd}\0${command}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const isPath = (token) => !/\s/.test(token) && /[/.]/.test(token);

export function taskFiles(planText, taskNumber) {
  const lines = planText.split("\n");
  const heading = new RegExp(`^### Task ${taskNumber}(?!\\d)`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) throw new Error(`the plan has no "### Task ${taskNumber}" heading.`);
  const end = lines.findIndex((line, index) => index > start && /^#{1,3} /.test(line));
  const files = lines
    .slice(start + 1, end === -1 ? undefined : end)
    .filter((line) => FILE_LINE.test(line))
    .flatMap((line) => [...line.matchAll(/`([^`]+)`/g)].map(([, token]) => token))
    .filter(isPath)
    .map((token) => token.replace(/:\d[\d,-]*$/, ""));
  if (files.length === 0) throw new Error(`task ${taskNumber} lists no files.`);
  return [...new Set(files)];
}

export function outOfScope(changedFiles, allowedFiles) {
  return changedFiles.filter(
    (file) => !allowedFiles.some((allowed) => allowed === file || (allowed.endsWith("/") && file.startsWith(allowed))),
  );
}

export function tail(text, count) {
  return text.replace(/\n+$/, "").split("\n").slice(-count).join("\n");
}

export function gatePassed({ results, scope }) {
  return results.every((result) => result.ok) && (!scope || scope.outside.length === 0);
}

function checkLine({ cwd, command, ok, seconds, log }) {
  const where = cwd === "." ? "" : ` in \`${cwd}/\``;
  return `- ${ok ? "PASS" : "FAIL"} \`${command}\`${where} (${seconds}s)${ok ? "" : ` — full log: ${log}`}`;
}

function scopeLine(scope) {
  if (!scope) return "Scope: not checked (no --plan)";
  if (scope.outside.length === 0) return `Scope: PASS — every changed file is in task ${scope.task}'s Files list`;
  const files = scope.outside.map((file) => `\`${file}\``).join(", ");
  return `Scope: FAIL — not in task ${scope.task}'s Files list: ${files}`;
}

export function renderGateReport({ round, sha, results, scope }) {
  const lines = [`# Gate r${round}`, "", `HEAD: ${sha}`, ""];
  if (results.length === 0) lines.push("No checks apply to the changed files.");
  lines.push(...results.map(checkLine));
  for (const failed of results.filter((result) => !result.ok)) {
    lines.push("", `## \`${failed.command}\` — last 40 lines`, "", "```text", failed.tail, "```");
  }
  lines.push("", scopeLine(scope), "", `RESULT: ${gatePassed({ results, scope }) ? "PASS" : "FAIL"}`);
  return `${lines.join("\n")}\n`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/gateCore.test.mjs && npm run test:scripts`
Expected: PASS, and the rest of the scripts suite still passes.

- [ ] **Step 5: Commit**

```bash
git add scripts/gateCore.mjs scripts/gateCore.test.mjs && git commit -F - <<'EOF'
Add gateCore: which Verify commands a change needs, and its scope

Each task's verify commands ran up to three times (implementer, spec
reviewer, quality reviewer). The gate reads them from the AGENTS.md
files that already list them, and checks the change against the plan
task's Files list, so scope creep fails mechanically.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: `runLog.mjs` and the `gate.mjs` CLI

**Files:**
- Create: `scripts/runLog.mjs`
- Test: `scripts/runLog.test.mjs`
- Create: `scripts/gate.mjs`
- Modify: `AGENTS.md` (the paragraph after `<!-- END agent-table -->`)

**Interfaces:**
- Consumes: everything `scripts/gateCore.mjs` exports (Task 2).
- Produces (named exports of `scripts/runLog.mjs`, also used by Task 5):
  - `runsDir(worktreeRoot: string, branch: string) → string`
  - `roundLogPath(gitCommonDir: string) → string`
  - `nextRound(names: string[], kind: string) → number` — `kind` is `"gate"`, `"codex-plan"` or `"codex-branch"`; counts `<kind>-rN.md`.
  - `appendRound(path: string, entry: object) → void`
- Produces: `node scripts/gate.mjs [--plan <file> --task <N>]`, writing `gate-rN.md` and `gate-rN-<k>.log` and printing `[gate] <report path>: RESULT: PASS|FAIL`.

- [ ] **Step 1: Write the failing tests**

`scripts/runLog.test.mjs`:

```js
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appendRound, nextRound, roundLogPath, runsDir } from "./runLog.mjs";

test("runsDir gives each branch its own folder, slashes flattened", () => {
  assert.equal(runsDir("/w", "claude/a-b"), "/w/.superpowers/runs/claude-a-b");
  assert.notEqual(runsDir("/w", "claude/a"), runsDir("/w", "claude/b"));
});

test("roundLogPath lands in the main checkout, outside every worktree", () => {
  assert.equal(roundLogPath("/repo/.git"), "/repo/.superpowers/rounds.jsonl");
});

test("nextRound counts only that kind's reports", () => {
  assert.equal(nextRound([], "gate"), 1);
  assert.equal(nextRound(["gate-r1.md", "gate-r1-1.log", "gate-r3.md", "codex-plan-r5.md"], "gate"), 4);
  assert.equal(nextRound(["gate-r2.md", "codex-plan-r1.jsonl"], "codex-plan"), 1);
  assert.equal(nextRound(["codex-plan-r1.md", "codex-branch-r4.md"], "codex-plan"), 2);
});

test("appendRound creates the folder and appends one JSON line per run", () => {
  const path = join(mkdtempSync(join(tmpdir(), "rounds-")), ".superpowers", "rounds.jsonl");
  appendRound(path, { kind: "gate", round: 1 });
  appendRound(path, { kind: "gate", round: 2 });
  const lines = readFileSync(path, "utf8").trimEnd().split("\n");
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[1]), { kind: "gate", round: 2 });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/runLog.test.mjs`
Expected: FAIL — `Cannot find module` for `./runLog.mjs`.

- [ ] **Step 3: Implement `scripts/runLog.mjs`**

```js
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export function runsDir(worktreeRoot, branch) {
  return join(worktreeRoot, ".superpowers", "runs", branch.replaceAll("/", "-"));
}

export function roundLogPath(gitCommonDir) {
  return join(dirname(gitCommonDir), ".superpowers", "rounds.jsonl");
}

export function nextRound(names, kind) {
  const pattern = new RegExp(`^${kind}-r(\\d+)\\.md$`);
  const rounds = names.map((name) => name.match(pattern)?.[1]).filter(Boolean).map(Number);
  return Math.max(0, ...rounds) + 1;
}

export function appendRound(path, entry) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/runLog.test.mjs`
Expected: PASS.

- [ ] **Step 5: Write the CLI `scripts/gate.mjs`**

```js
#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  agentsFilesFor,
  gatePassed,
  outOfScope,
  parseGateArgs,
  renderGateReport,
  tail,
  taskFiles,
  verifyCommands,
} from "./gateCore.mjs";
import { appendRound, nextRound, roundLogPath, runsDir } from "./runLog.mjs";

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function nulSeparated(text) {
  return text.split("\0").filter(Boolean);
}

function runCheck(root, dir, round, index, { cwd, command }) {
  const log = `gate-r${round}-${index + 1}.log`;
  const logPath = join(dir, log);
  const fd = openSync(logPath, "w");
  const started = Date.now();
  const run = spawnSync(command, { cwd: join(root, cwd), shell: true, stdio: ["ignore", fd, fd] });
  closeSync(fd);
  if (run.error) writeFileSync(logPath, `${run.error.message}\n`, { flag: "a" });
  const ok = run.status === 0 && !run.error;
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(`[gate] ${ok ? "PASS" : "FAIL"} ${command} (${seconds}s)`);
  return { cwd, command, ok, seconds, log, tail: ok ? "" : tail(readFileSync(logPath, "utf8"), 40) };
}

function main() {
  const { plan, task } = parseGateArgs(process.argv.slice(2));
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  const changed = [
    ...new Set([
      ...nulSeparated(git(root, ["diff", "--name-only", "-z", "HEAD"])),
      ...nulSeparated(git(root, ["ls-files", "--others", "--exclude-standard", "-z"])),
    ]),
  ];
  if (changed.length === 0) {
    console.error("[gate] nothing changed against HEAD.");
    process.exitCode = 1;
    return;
  }

  const sha = git(root, ["rev-parse", "--short", "HEAD"]).trim();
  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  const scope = plan ? { task, outside: outOfScope(changed, taskFiles(readFileSync(plan, "utf8"), task)) } : null;
  const commands = verifyCommands(agentsFilesFor(changed), (file) => readFileSync(join(root, file), "utf8"));

  const dir = runsDir(root, branch);
  mkdirSync(dir, { recursive: true });
  const round = nextRound(readdirSync(dir), "gate");
  const started = Date.now();
  const results = commands.map((check, index) => runCheck(root, dir, round, index, check));
  const pass = gatePassed({ results, scope });

  const report = join(dir, `gate-r${round}.md`);
  writeFileSync(report, renderGateReport({ round, sha, results, scope }));
  const commonDir = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim();
  appendRound(roundLogPath(commonDir), {
    at: new Date().toISOString(),
    branch,
    kind: "gate",
    round,
    model: null,
    exit: pass ? 0 : 1,
    seconds: Math.round((Date.now() - started) / 1000),
    tokens: null,
  });
  console.log(`[gate] ${relative(root, report)}: RESULT: ${pass ? "PASS" : "FAIL"}`);
  process.exitCode = pass ? 0 : 1;
}

try {
  main();
} catch (error) {
  console.error(`[gate] failed: ${error.message}`);
  process.exitCode = 1;
}
```

- [ ] **Step 6: Add the root Verify line**

In `AGENTS.md`, replace the line

```
Run `typecheck` and `lint` after changes in that package. Verify with tests before claiming done.
```

with

```
Run `typecheck` and `lint` after changes in that package. Verify with tests before claiming done: `node scripts/gate.mjs` runs every Verify command a change needs, from each package's `AGENTS.md` and the line below.

- Verify: `npm run test:scripts` (changes under `scripts/`)
```

Run: `npm run check:agents`
Expected: exit 0.

- [ ] **Step 7: Run the gate on this task, then prove scope fails**

Run: `node scripts/gate.mjs --plan docs/superpowers/plans/2026-10-16-codex-second-review.md --task 3; echo "exit $?"`
Expected: one check, `PASS npm run test:scripts`; `RESULT: PASS`; `exit 0`. `cat` the printed report: `Scope: PASS`.

Run: `node scripts/gate.mjs --plan docs/superpowers/plans/2026-10-16-codex-second-review.md --task 2; echo "exit $?"`
Expected: `RESULT: FAIL`, `exit 1`, and the report's scope line names `scripts/runLog.mjs`, `scripts/runLog.test.mjs`, `scripts/gate.mjs` and `AGENTS.md`.

Run: `tail -2 "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/.superpowers/rounds.jsonl"`
Expected: two `"kind":"gate"` lines for this branch, exits 0 then 1.

- [ ] **Step 8: Commit**

```bash
git add scripts/runLog.mjs scripts/runLog.test.mjs scripts/gate.mjs AGENTS.md && git commit -F - <<'EOF'
Add the gate CLI and the per-round log

The gate runs a change's Verify commands once, writes a short report
reviewers can read instead of re-running them, and keeps full logs out
of every agent's context. Each run appends a line to the main
checkout's .superpowers/rounds.jsonl, which outlives worktrees.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: `codexReview.mjs` and the review briefs

**Files:**
- Create: `scripts/codexReview.mjs`
- Test: `scripts/codexReview.test.mjs`
- Create: `scripts/codex/plan-review.md`
- Create: `scripts/codex/branch-review.md`

**Interfaces:**
- Consumes: `scripts/fixtures/codex-exec.jsonl` (Task 1). If Task 1 recorded usage or model under other names than below, `codexUsage` and its synthetic test follow the recording.
- Produces (named exports of `scripts/codexReview.mjs`, used by Task 5):
  - `MODES: { plan: { brief: "plan-review.md", usage: string }, branch: { brief: "branch-review.md", usage: string } }`
  - `parseReviewArgs(argv: string[]) → { mode: "plan" | "branch", spec: string, plan?: string }` — throws a usage error.
  - `buildPrompt(brief: string, { spec: string, plan?: string }) → string`
  - `codexUsage(jsonl: string) → { model: string | null, tokens: { input: number, cached: number, output: number } }`
  - `parseFindings(text: string) → { verdict: "pass" | "fail", findings: { severity, file, line, summary, scenario }[] }` — throws on invalid JSON or shape.
  - `codexVerdict(result) → "CODEX: PASS" | "CODEX: FAIL — <n> blocking"`
  - `renderCodexReport({ mode, round, seconds, usage, result, error }) → string` — `error` is a string or `null`; with an error, `result` is ignored.

- [ ] **Step 1: Write the failing tests**

`scripts/codexReview.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildPrompt, codexUsage, codexVerdict, parseFindings, parseReviewArgs, renderCodexReport } from "./codexReview.mjs";

const USAGE = { model: "gpt-6.1-sol", tokens: { input: 1300, cached: 1000, output: 350 } };
const FINDING = { severity: "blocking", file: "backend/src/a.ts", line: 12, summary: "Token leaks", scenario: "A shared link returns the owner's token." };

test("parseReviewArgs needs a plan in plan mode and a spec in both", () => {
  assert.deepEqual(parseReviewArgs(["plan", "s.md", "p.md"]), { mode: "plan", spec: "s.md", plan: "p.md" });
  assert.deepEqual(parseReviewArgs(["branch", "s.md"]), { mode: "branch", spec: "s.md", plan: undefined });
  assert.throws(() => parseReviewArgs(["plan", "s.md"]), /usage: .*plan <spec.md> <plan.md>/);
  assert.throws(() => parseReviewArgs(["branch"]), /usage: /);
  assert.throws(() => parseReviewArgs(["review", "s.md"]), /usage: /);
  assert.throws(() => parseReviewArgs(["constructor", "s.md"]), /usage: /);
});

test("buildPrompt appends the files to review after the brief", () => {
  assert.equal(buildPrompt("Brief.\n", { spec: "s.md", plan: "p.md" }), "Brief.\n\nSpec: s.md\nPlan: p.md\n");
  assert.equal(buildPrompt("Brief.", { spec: "s.md" }), "Brief.\n\nSpec: s.md\n");
});

test("codexUsage sums usage across turns and skips non-JSON lines", () => {
  const jsonl = [
    '{"type":"thread.started","thread_id":"t1"}',
    "warning: something on stdout",
    '{"type":"turn.completed","usage":{"input_tokens":1200,"cached_input_tokens":1000,"output_tokens":300}}',
    '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":0,"output_tokens":50}}',
    "",
  ].join("\n");
  assert.deepEqual(codexUsage(jsonl), { model: null, tokens: { input: 1300, cached: 1000, output: 350 } });
});

test("codexUsage reads the recorded Codex run", () => {
  const usage = codexUsage(readFileSync(new URL("./fixtures/codex-exec.jsonl", import.meta.url), "utf8"));
  assert.ok(usage.tokens.input > 0);
  assert.ok(usage.tokens.output > 0);
});

test("parseFindings accepts the schema's shape", () => {
  assert.deepEqual(parseFindings(JSON.stringify({ verdict: "fail", findings: [FINDING] })), { verdict: "fail", findings: [FINDING] });
});

test("parseFindings refuses empty or malformed output", () => {
  assert.throws(() => parseFindings(""), SyntaxError);
  assert.throws(() => parseFindings('{"verdict":"maybe","findings":[]}'), /verdict/);
  assert.throws(() => parseFindings('{"verdict":"pass"}'), /findings/);
  assert.throws(() => parseFindings(JSON.stringify({ verdict: "fail", findings: [{ ...FINDING, severity: "nit" }] })), /severity/);
  assert.throws(() => parseFindings(JSON.stringify({ verdict: "fail", findings: [{ ...FINDING, scenario: " " }] })), /scenario/);
  assert.throws(() => parseFindings(JSON.stringify({ verdict: "fail", findings: [{ ...FINDING, line: "12" }] })), /line/);
});

test("a pass verdict with a blocking finding is still a fail", () => {
  assert.equal(codexVerdict({ verdict: "pass", findings: [FINDING] }), "CODEX: FAIL — 1 blocking");
  assert.equal(codexVerdict({ verdict: "fail", findings: [] }), "CODEX: FAIL — 0 blocking");
  assert.equal(codexVerdict({ verdict: "pass", findings: [{ ...FINDING, severity: "follow-up" }] }), "CODEX: PASS");
});

test("a report groups findings by severity and ends on the verdict", () => {
  const followUp = { ...FINDING, severity: "follow-up", summary: "Later" };
  const report = renderCodexReport({ mode: "branch", round: 2, seconds: 412, usage: USAGE, result: { verdict: "fail", findings: [followUp, FINDING] }, error: null });
  assert.match(report, /^# Codex branch review r2\n/);
  assert.match(report, /Model: gpt-6.1-sol · 412s · tokens in 1300 \(cached 1000\), out 350/);
  assert.match(report, /## Blocking\n\n1\. `backend\/src\/a.ts:12` — Token leaks\n {3}Scenario: A shared link/);
  assert.ok(report.indexOf("## Blocking") < report.indexOf("## Follow-ups"));
  assert.equal(report.trimEnd().split("\n").at(-1), "CODEX: FAIL — 1 blocking");
});

test("a clean report says so and passes", () => {
  const report = renderCodexReport({ mode: "plan", round: 1, seconds: 60, usage: { model: null, tokens: { input: 1, cached: 0, output: 1 } }, result: { verdict: "pass", findings: [] }, error: null });
  assert.match(report, /Model: unknown/);
  assert.match(report, /No findings\./);
  assert.equal(report.trimEnd().split("\n").at(-1), "CODEX: PASS");
});

test("an error report never says pass", () => {
  const report = renderCodexReport({ mode: "plan", round: 1, seconds: 3, usage: USAGE, result: null, error: "codex exited 1" });
  assert.equal(report.trimEnd().split("\n").at(-1), "CODEX: ERROR — codex exited 1");
  assert.doesNotMatch(report, /CODEX: PASS/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/codexReview.test.mjs`
Expected: FAIL — `Cannot find module` for `./codexReview.mjs`.

- [ ] **Step 3: Implement `scripts/codexReview.mjs`**

```js
export const MODES = {
  plan: { brief: "plan-review.md", usage: "plan <spec.md> <plan.md>" },
  branch: { brief: "branch-review.md", usage: "branch <spec.md> [plan.md]" },
};

const SEVERITIES = [
  ["blocking", "Blocking"],
  ["should-fix", "Should fix"],
  ["follow-up", "Follow-ups"],
];

export function parseReviewArgs(argv) {
  const [mode, spec, plan] = argv;
  if (!Object.hasOwn(MODES, mode)) throw new Error(`usage: codex-review.mjs ${MODES.plan.usage} | ${MODES.branch.usage}`);
  if (!spec || (mode === "plan" && !plan)) throw new Error(`usage: codex-review.mjs ${MODES[mode].usage}`);
  return { mode, spec, plan };
}

export function buildPrompt(brief, { spec, plan }) {
  return [brief.trimEnd(), "", `Spec: ${spec}`, ...(plan ? [`Plan: ${plan}`] : [])].join("\n") + "\n";
}

export function codexUsage(jsonl) {
  let model = null;
  const tokens = { input: 0, cached: 0, output: 0 };
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      if (error instanceof SyntaxError) continue;
      throw error;
    }
    if (model === null && typeof event.model === "string") model = event.model;
    if (event.usage) {
      tokens.input += event.usage.input_tokens ?? 0;
      tokens.cached += event.usage.cached_input_tokens ?? 0;
      tokens.output += event.usage.output_tokens ?? 0;
    }
  }
  return { model, tokens };
}

export function parseFindings(text) {
  const value = JSON.parse(text);
  if (value?.verdict !== "pass" && value?.verdict !== "fail") throw new Error("verdict must be pass or fail");
  if (!Array.isArray(value.findings)) throw new Error("findings must be an array");
  for (const finding of value.findings) {
    if (!SEVERITIES.some(([severity]) => severity === finding?.severity)) {
      throw new Error(`unknown severity ${JSON.stringify(finding?.severity)}`);
    }
    for (const key of ["file", "summary", "scenario"]) {
      if (typeof finding[key] !== "string" || !finding[key].trim()) throw new Error(`a finding has no ${key}`);
    }
    if (!Number.isInteger(finding.line)) throw new Error("a finding's line must be an integer");
  }
  return value;
}

export function codexVerdict(result) {
  const blocking = result.findings.filter((finding) => finding.severity === "blocking").length;
  return result.verdict === "pass" && blocking === 0 ? "CODEX: PASS" : `CODEX: FAIL — ${blocking} blocking`;
}

export function renderCodexReport({ mode, round, seconds, usage, result, error }) {
  const { input, cached, output } = usage.tokens;
  const lines = [
    `# Codex ${mode} review r${round}`,
    "",
    `Model: ${usage.model ?? "unknown"} · ${seconds}s · tokens in ${input} (cached ${cached}), out ${output}`,
    "",
  ];
  if (error) return `${[...lines, `CODEX: ERROR — ${error}`].join("\n")}\n`;
  if (result.findings.length === 0) lines.push("No findings.", "");
  for (const [severity, title] of SEVERITIES) {
    const found = result.findings.filter((finding) => finding.severity === severity);
    if (found.length === 0) continue;
    lines.push(`## ${title}`, "");
    found.forEach((finding, index) => {
      lines.push(`${index + 1}. \`${finding.file}:${finding.line}\` — ${finding.summary}`, `   Scenario: ${finding.scenario}`);
    });
    lines.push("");
  }
  lines.push(codexVerdict(result));
  return `${lines.join("\n")}\n`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/codexReview.test.mjs`
Expected: PASS.

- [ ] **Step 5: Write the briefs**

`scripts/codex/plan-review.md`:

````markdown
You are reviewing an implementation plan for Scripta before anyone writes code. Another model wrote the spec and the plan; you did not, and your job is to find what it got wrong. You are read-only: read files and run read-only commands (`git log`, `git show`, `rg`, `ls`, `cat`). Change nothing.

Read the root `AGENTS.md`, the spec, the plan, and the `AGENTS.md` of each package the plan touches. Then check, most severe first:

1. **Coverage:** every requirement in the spec is delivered by some task. Name the requirement no task delivers.
2. **Reality:** every file path, line number, function name, type and interface the plan cites exists in the code as the plan describes it. Open the file and check; a plan written from memory is the most common failure.
3. **Order:** each task builds, and its tests pass, using only what earlier tasks produced.
4. **Tests:** each task's tests fail without its change and would catch the obvious wrong implementation.
5. **Repo rules:** logic that belongs in `@scripta/shared`; backend `*.test.ts` files missing from `npm test`'s explicit list; a `*_DB_PATH` outside `/data` or missing from `backend/litestream.yml`; Railway variables, migrations or deploy steps the plan never mentions.

For each finding give the file and line it is about (the plan's own line when the problem is in the plan; 1 when no single line applies), a one-sentence summary, and a concrete scenario: the input, state or step that goes wrong. Drop anything you cannot make concrete. `blocking`: coding from this plan gives a wrong or failing result. `should-fix`: it works, but worse than it should. `follow-up`: outside this plan's scope. Verdict `fail` when anything is blocking.
````

`scripts/codex/branch-review.md`:

````markdown
You are reviewing a Scripta branch before it merges to main. Other models planned, wrote and reviewed it; you did not, and your job is to find what they all missed. You are read-only: read files and run read-only commands (`git diff`, `git log`, `git show`, `rg`, `ls`, `cat`). Change nothing, and don't run tests — a separate gate already has.

Read the root `AGENTS.md`, the spec, the plan if one is given, and the `AGENTS.md` of each package the branch touches. Then read the whole change, `git diff origin/main...HEAD` and `git log --oneline origin/main..HEAD`, and the code around it wherever a judgement depends on it.

Judge against the spec first: a plan can be wrong, and every earlier review saw only the plan. Look for, most severe first:

1. **Spec gaps:** requirements the branch doesn't deliver, or delivers differently on web and mobile.
2. **Correctness:** logic errors, unhandled inputs, races, broken callers of changed functions, wrong types at boundaries.
3. **Security:** auth checks, share-link exposure, token handling. The backend holds accounts, OAuth tokens and public share links.
4. **Swallowed errors:** a catch that returns null or empty for a failure, so the caller reads "failed" as "nothing there".
5. **Deploy impact:** new env vars, a `*_DB_PATH` outside `/data` or missing from `backend/litestream.yml`, migrations, `.railway/railway.ts` or workflow changes.
6. **Tests:** changed behaviour that no test would catch breaking.

For each finding give the file and line (1 when no single line applies), a one-sentence summary, and a concrete scenario: the input or state that breaks. Drop anything you cannot make concrete. `blocking`: must be fixed before merge. `should-fix`: worth fixing on this branch. `follow-up`: a separate PR or a user action. Verdict `fail` when anything is blocking.
````

- [ ] **Step 6: Run the scripts suite**

Run: `npm run test:scripts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/codexReview.mjs scripts/codexReview.test.mjs scripts/codex/plan-review.md scripts/codex/branch-review.md && git commit -F - <<'EOF'
Add codexReview: Codex review briefs, findings parsing and reports

Every plan and branch was written and reviewed by Claude models only.
These briefs point a read-only Codex run at the plan before coding and
the branch before merge; malformed output is an error, never a pass.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: The `codex-review.mjs` CLI

**Files:**
- Create: `scripts/codex-review.mjs`

**Interfaces:**
- Consumes: `MODES`, `parseReviewArgs`, `buildPrompt`, `codexUsage`, `parseFindings`, `codexVerdict`, `renderCodexReport` (Task 4); `runsDir`, `roundLogPath`, `nextRound`, `appendRound` (Task 3); `scripts/codex/findings.schema.json` (Task 1).
- Produces: `node scripts/codex-review.mjs plan <spec> <plan>` and `… branch <spec> [plan]`, writing `codex-<mode>-rN.md` (plus `.json`, `.jsonl`, `.stderr.log`) and printing `[codex-review] <report path>: <verdict line>`.

- [ ] **Step 1: Write `scripts/codex-review.mjs`**

```js
#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MODES,
  buildPrompt,
  codexUsage,
  codexVerdict,
  parseFindings,
  parseReviewArgs,
  renderCodexReport,
} from "./codexReview.mjs";
import { appendRound, nextRound, roundLogPath, runsDir } from "./runLog.mjs";

const CODEX_DIR = join(dirname(fileURLToPath(import.meta.url)), "codex");
const TIMEOUT_MS = 45 * 60 * 1000;

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function repoPath(root, file) {
  const absolute = resolve(process.cwd(), file);
  if (!existsSync(absolute)) throw new Error(`${file} not found.`);
  return relative(root, absolute);
}

function runCodex(root, prompt, base) {
  const eventsFd = openSync(`${base}.jsonl`, "w");
  const errorsFd = openSync(`${base}.stderr.log`, "w");
  try {
    return spawnSync(
      "codex",
      ["exec", "-s", "read-only", "-C", root, "--json", "--output-schema", join(CODEX_DIR, "findings.schema.json"), "-o", `${base}.json`, "-"],
      { input: prompt, stdio: ["pipe", eventsFd, errorsFd], timeout: TIMEOUT_MS },
    );
  } finally {
    closeSync(eventsFd);
    closeSync(errorsFd);
  }
}

function reviewError(root, run, base, treeChanged) {
  if (treeChanged) return "the working tree changed during a read-only review";
  if (run.error?.code === "ETIMEDOUT") return "codex timed out after 45 minutes";
  if (run.error) return `codex did not start: ${run.error.message}`;
  if (run.status !== 0) return `codex exited ${run.status}; see ${relative(root, `${base}.stderr.log`)}`;
  return null;
}

function main() {
  const args = parseReviewArgs(process.argv.slice(2));
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]);
  const spec = repoPath(root, args.spec);
  const plan = args.plan && repoPath(root, args.plan);
  if (args.mode === "branch") git(root, ["fetch", "-q", "origin", "main"]);

  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const dir = runsDir(root, branch);
  mkdirSync(dir, { recursive: true });
  const kind = `codex-${args.mode}`;
  const round = nextRound(readdirSync(dir), kind);
  const base = join(dir, `${kind}-r${round}`);

  const brief = readFileSync(join(CODEX_DIR, MODES[args.mode].brief), "utf8");
  const before = git(root, ["status", "--porcelain"]);
  const started = Date.now();
  console.log(`[codex-review] ${args.mode} review r${round} running…`);
  const run = runCodex(root, buildPrompt(brief, { spec, plan }), base);
  const seconds = Math.round((Date.now() - started) / 1000);
  const treeChanged = git(root, ["status", "--porcelain"]) !== before;
  const usage = codexUsage(readFileSync(`${base}.jsonl`, "utf8"));

  let error = reviewError(root, run, base, treeChanged);
  let result = null;
  if (!error) {
    try {
      result = parseFindings(readFileSync(`${base}.json`, "utf8"));
    } catch (parseError) {
      error = `output did not match the schema: ${parseError.message}`;
    }
  }

  const report = `${base}.md`;
  writeFileSync(report, renderCodexReport({ mode: args.mode, round, seconds, usage, result, error }));
  const verdict = error ? `CODEX: ERROR — ${error}` : codexVerdict(result);
  const exit = error ? 2 : verdict === "CODEX: PASS" ? 0 : 1;
  appendRound(roundLogPath(git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"])), {
    at: new Date().toISOString(),
    branch,
    kind,
    round,
    model: usage.model,
    exit,
    seconds,
    tokens: usage.tokens,
  });
  console.log(`[codex-review] ${relative(root, report)}: ${verdict}`);
  process.exitCode = exit;
}

try {
  main();
} catch (error) {
  console.error(`[codex-review] failed: ${error.message}`);
  process.exitCode = 2;
}
```

- [ ] **Step 2: Check the error path**

Run: `PATH=/usr/bin:/bin "$(command -v node)" scripts/codex-review.mjs plan docs/superpowers/specs/2026-10-16-codex-second-review-design.md docs/superpowers/plans/2026-10-16-codex-second-review.md; echo "exit $?"`
Expected: `CODEX: ERROR — codex did not start: spawnSync codex ENOENT`, `exit 2`; the report's last line is the same `CODEX: ERROR` line.

Run: `node scripts/codex-review.mjs plan docs/superpowers/specs/2026-10-16-codex-second-review-design.md; echo "exit $?"`
Expected: `[codex-review] failed: usage: codex-review.mjs plan <spec.md> <plan.md>`, `exit 2`.

- [ ] **Step 3: Run a real plan review**

Run with Bash `run_in_background: true` and wait for its notification (it can take 10+ minutes at the configured effort):

`node scripts/codex-review.mjs plan docs/superpowers/specs/2026-10-16-codex-second-review-design.md docs/superpowers/plans/2026-10-16-codex-second-review.md`

Expected: exit 0 or 1 (never 2); the printed report has a `Model:` line with non-zero token counts and ends `CODEX: PASS` or `CODEX: FAIL — <n> blocking`; `git status --porcelain` shows only this task's file. A new `"kind":"codex-plan"` line with tokens is in the main checkout's `.superpowers/rounds.jsonl`. Include the report's path in your report — the main session reads its findings.

- [ ] **Step 4: Commit**

```bash
git add scripts/codex-review.mjs && git commit -F - <<'EOF'
Add codex-review: run a read-only Codex review of a plan or branch

The main session runs it in the background at the two points where one
vendor graded its own work. A failed run, a changed tree or malformed
output reports CODEX: ERROR and exits 2, so no failure reads as a pass.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Route agents, CLAUDE.md and the ship skill through the gate and Codex

**Files:**
- Modify: `.claude/agents/implementer.md:23-29`
- Modify: `.claude/agents/spec-reviewer.md:10-18`
- Modify: `.claude/agents/quality-reviewer.md:10-22`
- Modify: `.claude/agents/branch-reviewer.md`
- Modify: `CLAUDE.md:9-22`
- Modify: `.claude/skills/ship/SKILL.md:34`

**Interfaces:**
- Consumes: `node scripts/gate.mjs` (Task 3), `node scripts/codex-review.mjs` (Task 5), the `gate-rN.md` format (`HEAD: <short sha>`, last line `RESULT: PASS|FAIL`).

- [ ] **Step 1: `implementer.md`**

Replace

```
Verify before committing — run every Verify command from each touched package's `AGENTS.md`. If you touched `packages/shared`, run `npm run build --workspace @scripta/shared` first, since consumers read `dist/`. Also run `npm run lint --workspace frontend` for frontend changes.
```

with

```
Verify before committing: from the worktree root run `node scripts/gate.mjs --plan <plan file> --task <N>`, or `node scripts/gate.mjs` when there is no plan. It runs every Verify command the change needs, checks the changed files against the task's **Files:** list, and prints its report's path and `RESULT: PASS` or `RESULT: FAIL`. Read the report, fix, and run it again until it passes. If the task needs a file its list doesn't name, don't commit; report it.
```

Replace `Commit only when every check passes,` with `Commit only on \`RESULT: PASS\`,`.

Replace

```
Report back: files changed, each verify command with its result, the commit SHA, and anything in the plan you had to interpret or could not do.
```

with

```
Report back, in this order: **Deviations and doubts** — where the plan didn't match the code, what you had to interpret, what you could not do, or "none"; files changed; the gate report's path and its `RESULT` line; the commit SHA.
```

- [ ] **Step 2: `spec-reviewer.md`**

In the read-only line, replace `` `grep`, `ls`, and the package verify commands.`` with `` `grep` and `ls`.``

Replace the line `1. Read the spec (task text or plan file) and list each requirement it states, including acceptance criteria and anything it explicitly says not to do.` with these two lines, and renumber the steps after them 3–6:

```
1. Read the newest `gate-rN.md` in `.superpowers/runs/<branch, every / as ->/`. Its `HEAD:` must be the parent of the commit under review and its last line `RESULT: PASS`; otherwise count it as a missing requirement. If the prompt includes the implementer's report, read its **Deviations and doubts** next.
2. Read the spec (task text or plan file) and list each requirement it states, including acceptance criteria and anything it explicitly says not to do.
```

- [ ] **Step 3: `quality-reviewer.md`**

In the read-only line, replace `` `grep`, `ls`, and the package verify commands.`` with `` `grep` and `ls`.``

Replace `Read the root \`AGENTS.md\` and each touched package's \`AGENTS.md\` first, then the diff and the code around it.` with:

```
Read the root `AGENTS.md` and each touched package's `AGENTS.md` first; if the prompt includes the implementer's report, read its **Deviations and doubts**; then the diff and the code around it.
```

Replace `Run the Verify commands from each touched package's \`AGENTS.md\` and report their results.` with:

```
Don't run the Verify commands: read the newest `gate-rN.md` in `.superpowers/runs/<branch, every / as ->/`. If its `HEAD:` isn't the parent of the commit under review, or its last line isn't `RESULT: PASS`, report that as blocking.
```

- [ ] **Step 4: `branch-reviewer.md`**

In the frontmatter description, replace `Give it the worktree path and the spec or plan file.` with `Give it the worktree path, the spec file and the plan file.`

Replace `1. Read the spec or plan, the root \`AGENTS.md\`, and each touched package's \`AGENTS.md\`.` with `1. Read the spec, the plan, the root \`AGENTS.md\`, and each touched package's \`AGENTS.md\`.`

Replace `1. **Spec coverage across the branch:** requirements no task delivered, or delivered twice in different ways.` with:

```
1. **Spec coverage across the branch**, judged against the spec first — a plan can be wrong in a way the per-task reviews, which only saw the plan, never catch: requirements no task delivered, or delivered twice in different ways.
```

- [ ] **Step 5: `CLAUDE.md`**

Replace the row

```
| Codebase fact-finding before a spec or plan | `Explore`, `model: "sonnet"` |
```

with

```
| Codebase fact-finding before a spec or plan | `Explore`, `model: "sonnet"`; ask for a report under ~600 words where every claim cites `path:line`, with open technical questions kept apart from decisions only the user can make |
```

Replace the row

```
| Once per branch before merge, or a plan before coding | `branch-reviewer` |
```

with

```
| A plan is written, before the fresh-session handoff | `node scripts/codex-review.mjs plan <spec> <plan>` with Bash `run_in_background`; fix the plan from its report, then commit |
| Once per branch before merge | `branch-reviewer` with the spec and plan, and `node scripts/codex-review.mjs branch <spec> <plan>` in the background, in parallel |
```

At the end of the paragraph that ends `A task that failed twice on Sonnet is escalated to Opus, not retried a third time.`, append:

```
 A task gets at most 3 implement → review rounds; then the user chooses to rescope, re-plan or drop it. A finding both pre-merge reviews raise is presumed real; one raised by only one of them is checked in the code before acting on it. A `CODEX: ERROR` report means the second review didn't run — tell the user; never read it as a pass.
```

- [ ] **Step 6: ship skill**

In `.claude/skills/ship/SKILL.md`, replace `For a multi-task branch that hasn't had one, dispatch \`branch-reviewer\`.` with:

```
For a multi-task branch that hasn't had one, dispatch `branch-reviewer` and run `node scripts/codex-review.mjs branch <spec> [plan]` in the background, in parallel.
```

- [ ] **Step 7: Verify**

Run: `npm run check:agents && node scripts/gate.mjs --plan docs/superpowers/plans/2026-10-16-codex-second-review.md --task 6; echo "exit $?"`
Expected: check:agents exit 0; the gate reports `No checks apply to the changed files.`, `Scope: PASS`, `RESULT: PASS`, `exit 0`.

Run: `rg -n 'verify commands|Verify command' .claude/agents/`
Expected: only the implementer's gate paragraph and quality-reviewer's "Don't run the Verify commands" line.

- [ ] **Step 8: Commit**

```bash
git add .claude/agents/implementer.md .claude/agents/spec-reviewer.md .claude/agents/quality-reviewer.md .claude/agents/branch-reviewer.md CLAUDE.md .claude/skills/ship/SKILL.md && git commit -F - <<'EOF'
Route verify through the gate and add Codex at plan and merge

Implementers run the gate once; reviewers read its report instead of
re-running every check. Plans get a read-only Codex review before the
handoff and branches one alongside branch-reviewer, so a blind spot the
Claude models share has a second vendor's look before code or merge.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```
