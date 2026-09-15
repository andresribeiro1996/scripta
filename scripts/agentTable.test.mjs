import assert from "node:assert/strict";
import { test } from "node:test";
import { invariantProblems, parseAgentsFile, renderTable, replaceBlock } from "./agentTable.mjs";

const BACKEND = `# Backend

Fastify/TypeScript API, modular monolith. Read \`README.md\` before changing it.

## Commands

- Run: \`npm run dev --workspace backend\`
- Verify: \`npm run build --workspace @scripta/shared\`
- Verify: \`npm run typecheck --workspace backend\`
- Verify: \`npm test --workspace backend\`

## Rules

- Something else entirely.
`;

test("parseAgentsFile takes the description from the paragraph after the H1", () => {
  const parsed = parseAgentsFile(BACKEND, { workspaces: ["backend"] });
  assert.equal(parsed.what, "Fastify/TypeScript API, modular monolith");
});

test("parseAgentsFile keeps only commands belonging to this package", () => {
  const parsed = parseAgentsFile(BACKEND, { workspaces: ["backend"] });
  assert.deepEqual(parsed.commands, ["dev", "typecheck", "test"]);
});

test("parseAgentsFile keeps a root npm script with no workspace flag", () => {
  const mobile = `# Mobile

Expo/React Native app. Read \`README.md\` before changing it.

## Commands

- Start locally from the repository root: \`EXPO_PUBLIC_API_URL=http://<LAN-IP>:3000 npm run mobile\`
- Verify: \`npm run typecheck --workspace mobile\`
- Run Maestro only when a device or emulator is available.
`;
  const parsed = parseAgentsFile(mobile, { workspaces: ["mobile"] });
  assert.deepEqual(parsed.commands, ["mobile", "typecheck"]);
});

test("parseAgentsFile reads an npx tool through a cd prefix", () => {
  const mobile = `# Mobile

Expo app.

## Commands

- Verify Expo configuration: \`cd mobile && npx expo-doctor\`
`;
  const parsed = parseAgentsFile(mobile, { workspaces: ["mobile"] });
  assert.deepEqual(parsed.commands, ["expo-doctor"]);
});

test("parseAgentsFile matches a scoped workspace name", () => {
  const packages = `# Shared packages

\`@scripta/shared\` — the model every client reuses.

## Commands

- Verify: \`npm run build --workspace @scripta/shared\`
`;
  const parsed = parseAgentsFile(packages, { workspaces: ["packages", "@scripta/shared"] });
  assert.deepEqual(parsed.commands, ["build"]);
});

test("parseAgentsFile stops collecting at the next section", () => {
  const parsed = parseAgentsFile(BACKEND, { workspaces: ["backend"] });
  assert.ok(!parsed.commands.includes("else"));
});

test("parseAgentsFile rejects a file with no H1", () => {
  assert.throws(() => parseAgentsFile("no heading here\n", { workspaces: [] }), /H1/);
});

test("renderTable renders one row per entry with the first command spelled out", () => {
  const rows = [
    { dir: "backend/", what: "Fastify/TS API", commands: ["dev", "typecheck", "test"] },
    { dir: "viewer/", what: "Static single-file HTML", commands: [] },
  ];
  assert.equal(
    renderTable(rows),
    "| `backend/` | Fastify/TS API | `npm run dev` / `typecheck` / `test` |\n" +
      "| `viewer/` | Static single-file HTML | none |"
  );
});

test("replaceBlock swaps the body between the markers and keeps the rest", () => {
  const text = "before\n<!-- BEGIN table -->\nold\n<!-- END table -->\nafter\n";
  assert.equal(
    replaceBlock(text, "table", "new"),
    "before\n<!-- BEGIN table -->\nnew\n<!-- END table -->\nafter\n"
  );
});

test("replaceBlock ignores markers inside a fenced code block", () => {
  const text = [
    "```",
    "<!-- BEGIN table -->",
    "```",
    "<!-- BEGIN table -->",
    "old",
    "<!-- END table -->",
  ].join("\n");
  assert.match(replaceBlock(text, "table", "new"), /```\n<!-- BEGIN table -->\n```/);
});

test("replaceBlock throws when the markers are missing", () => {
  assert.throws(() => replaceBlock("nothing here\n", "table", "new"), /exactly one/);
});

test("replaceBlock throws when a marker is duplicated", () => {
  const text = "<!-- BEGIN table -->\na\n<!-- BEGIN table -->\nb\n<!-- END table -->\n";
  assert.throws(() => replaceBlock(text, "table", "new"), /exactly one/);
});

test("replaceBlock throws when END comes before BEGIN", () => {
  const text = "<!-- END table -->\na\n<!-- BEGIN table -->\n";
  assert.throws(() => replaceBlock(text, "table", "new"), /order/);
});

test("invariantProblems is silent when the symlink and instructions entry are present", () => {
  const problems = invariantProblems({
    dir: "backend",
    claudeMd: { exists: true, isSymlink: true, target: "AGENTS.md" },
    instructions: ["backend/AGENTS.md"],
  });
  assert.deepEqual(problems, []);
});

test("invariantProblems reports a missing CLAUDE.md symlink", () => {
  const problems = invariantProblems({
    dir: "backend",
    claudeMd: { exists: false, isSymlink: false, target: null },
    instructions: ["backend/AGENTS.md"],
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /backend\/CLAUDE\.md/);
});

test("invariantProblems reports a CLAUDE.md that is a real file rather than a symlink", () => {
  const problems = invariantProblems({
    dir: "backend",
    claudeMd: { exists: true, isSymlink: false, target: null },
    instructions: ["backend/AGENTS.md"],
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /not a symlink/);
});

test("invariantProblems reports a symlink pointing somewhere else", () => {
  const problems = invariantProblems({
    dir: "backend",
    claudeMd: { exists: true, isSymlink: true, target: "../AGENTS.md" },
    instructions: ["backend/AGENTS.md"],
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /\.\.\/AGENTS\.md/);
});

test("invariantProblems reports a missing opencode.json entry", () => {
  const problems = invariantProblems({
    dir: "backend",
    claudeMd: { exists: true, isSymlink: true, target: "AGENTS.md" },
    instructions: ["frontend/AGENTS.md"],
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /opencode\.json/);
});
