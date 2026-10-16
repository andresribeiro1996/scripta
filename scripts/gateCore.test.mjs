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

test("agentsFilesFor sends agent instruction files to the root AGENTS.md", () => {
  for (const file of ["AGENTS.md", "opencode.json", "viewer/AGENTS.md", "exporter/CLAUDE.md"]) {
    assert.deepEqual(agentsFilesFor([file]), ["AGENTS.md"], file);
  }
  assert.deepEqual(agentsFilesFor(["backend/CLAUDE.md"]), ["backend/AGENTS.md", "AGENTS.md"]);
  assert.deepEqual(agentsFilesFor(["docs/notes/AGENTS.md", "viewer/docs/CLAUDE.md"]), []);
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

test("taskFiles finds a ## heading", () => {
  assert.deepEqual(taskFiles("## Task 2: Next\n\n- Create: `a/b.ts`\n\n## Task 3: x\n\n- Create: `c/d.ts`", 2), ["a/b.ts"]);
});

test("taskFiles reads indented sub-bullets under a bare file line", () => {
  const plan = [
    "### Task 1: Nested",
    "",
    "- Modify:",
    "  - `a/one.ts`",
    "    - `a/two.ts` (note)",
    "- [ ] **Step 1:** edit `a/three.ts`",
  ].join("\n");
  assert.deepEqual(taskFiles(plan, 1), ["a/one.ts", "a/two.ts"]);
});

test("taskFiles refuses a glob", () => {
  assert.throws(() => taskFiles("### Task 1: G\n\n- Create: `packages/shared/src/community/*`", 1), /lists a glob/);
});

test("taskFiles reads a real ## plan", () => {
  const plan = readFileSync(new URL("../docs/superpowers/plans/2026-08-29-bookarena.md", import.meta.url), "utf8");
  assert.ok(taskFiles(plan, 1).length > 0);
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
