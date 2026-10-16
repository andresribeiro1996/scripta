const AGENTS_ORDER = ["packages/AGENTS.md", "backend/AGENTS.md", "frontend/AGENTS.md", "mobile/AGENTS.md", "AGENTS.md"];
const APPS = ["backend", "frontend", "mobile"];
const ROOT_MANIFESTS = new Set(["package.json", "package-lock.json"]);
const AGENT_CONFIG = new Set(["AGENTS.md", "CLAUDE.md"]);
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

function packageAgentsFor(top) {
  if (top === "packages") return ["packages/AGENTS.md", ...APPS.map((dir) => `${dir}/AGENTS.md`)];
  if (APPS.includes(top)) return [`${top}/AGENTS.md`];
  if (top === "scripts") return ["AGENTS.md"];
  return [];
}

function agentsFor(file) {
  if (ROOT_MANIFESTS.has(file)) return AGENTS_ORDER;
  if (file === "AGENTS.md" || file === "opencode.json") return ["AGENTS.md"];
  const [top, ...rest] = file.split("/");
  if (rest.length === 0) return [];
  const agentConfig = rest.length === 1 && AGENT_CONFIG.has(rest[0]) ? ["AGENTS.md"] : [];
  return [...agentConfig, ...packageAgentsFor(top)];
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
  const heading = new RegExp(`^#{2,3} Task ${taskNumber}(?!\\d)`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) throw new Error(`the plan has no "### Task ${taskNumber}" heading.`);
  const end = lines.findIndex((line, index) => index > start && /^#{1,3} /.test(line));
  let inFileRun = false;
  const tokens = lines
    .slice(start + 1, end === -1 ? undefined : end)
    .filter((line) => {
      if (FILE_LINE.test(line)) inFileRun = true;
      else if (!/^\s+- /.test(line)) inFileRun = false;
      return inFileRun;
    })
    .flatMap((line) => [...line.matchAll(/`([^`]+)`/g)].map(([, token]) => token))
    .filter(isPath);
  const glob = tokens.find((token) => /[*{]/.test(token));
  if (glob) throw new Error(`task ${taskNumber} lists a glob (${glob}); list its files one by one.`);
  const files = tokens.map((token) => token.replace(/:\d[\d,-]*$/, ""));
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
