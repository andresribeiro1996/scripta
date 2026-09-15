import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { invariantProblems, parseAgentsFile, renderTable, replaceBlock } from "./agentTable.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BLOCK = "agent-table";

const STANDALONE = [
  { dir: "exporter/", what: "Python stdlib script → `library.json`", rendered: "`python3 export.py`" },
  { dir: "viewer/", what: "Static single-file HTML", rendered: "none" },
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function packageNamesUnder(dir) {
  const names = [];
  for (const candidate of [dir, ...readdirSync(join(ROOT, dir), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(dir, entry.name))]) {
    const manifest = join(ROOT, candidate, "package.json");
    if (existsSync(manifest)) names.push(readJson(manifest).name);
  }
  return names;
}

function claudeMdFacts(dir) {
  const path = join(ROOT, dir, "CLAUDE.md");
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return { exists: false, isSymlink: false, target: null };
    throw error;
  }
  return {
    exists: true,
    isSymlink: stat.isSymbolicLink(),
    target: stat.isSymbolicLink() ? readlinkSync(path) : null,
  };
}

function documentedDirs() {
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(ROOT, name, "AGENTS.md")))
    .sort();
}

function collect() {
  const instructions = readJson(join(ROOT, "opencode.json")).instructions ?? [];
  const rows = [];
  const problems = [];

  for (const dir of documentedDirs()) {
    const workspaces = [dir, ...packageNamesUnder(dir)];
    const parsed = parseAgentsFile(readFileSync(join(ROOT, dir, "AGENTS.md"), "utf8"), { workspaces });
    rows.push({ dir: `${dir}/`, what: parsed.what, commands: parsed.commands });
    problems.push(...invariantProblems({ dir, claudeMd: claudeMdFacts(dir), instructions }));
  }

  return { rows, problems };
}

function main() {
  const check = process.argv.includes("--check");
  const { rows, problems } = collect();

  const body = [
    renderTable(rows),
    ...STANDALONE.map(({ dir, what, rendered }) => `| \`${dir}\` | ${what} | ${rendered} |`),
  ].join("\n");

  const path = join(ROOT, "AGENTS.md");
  const current = readFileSync(path, "utf8");
  const updated = replaceBlock(current, BLOCK, body);

  if (check) {
    if (updated !== current) {
      problems.push("the root AGENTS.md table is stale — run: node scripts/sync-agent-table.mjs");
    }
    if (problems.length > 0) {
      for (const problem of problems) console.error(`✗ ${problem}`);
      process.exit(1);
    }
    console.log(`✓ ${rows.length} documented packages, table and config in sync`);
    return;
  }

  for (const problem of problems) console.error(`✗ ${problem}`);
  if (updated !== current) {
    writeFileSync(path, updated);
    console.log(`✓ rewrote the table in AGENTS.md (${rows.length} documented packages)`);
  } else {
    console.log(`✓ table already current (${rows.length} documented packages)`);
  }
  if (problems.length > 0) process.exit(1);
}

main();
