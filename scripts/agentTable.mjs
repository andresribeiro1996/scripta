const FENCE = /^\s*(?:```|~~~)/;

function beginMarker(name) {
  return `<!-- BEGIN ${name} -->`;
}

function endMarker(name) {
  return `<!-- END ${name} -->`;
}

function scriptNameOf(command, workspaces) {
  const workspace = command.match(/--workspace\s+(\S+)/);
  if (workspace && !workspaces.includes(workspace[1])) return null;

  const npx = command.match(/\bnpx\s+(?:--yes\s+)?(\S+)/);
  if (npx) return npx[1];

  const run = command.match(/\bnpm\s+run\s+(\S+)/);
  if (run) return run[1];

  const bare = command.match(/\bnpm\s+(test|start|install)\b/);
  if (bare) return bare[1];

  return null;
}

export function parseAgentsFile(text, { workspaces }) {
  const lines = text.split("\n");
  const headingIndex = lines.findIndex((line) => line.startsWith("# "));
  if (headingIndex === -1) throw new Error("no H1 heading");

  const description = lines
    .slice(headingIndex + 1)
    .find((line) => line.trim() !== "");
  if (!description) throw new Error("no description paragraph after the H1");

  const what = description
    .replace(/\s*Read `README\.md` before changing it\.\s*$/, "")
    .trim()
    .replace(/\.$/, "");

  const commandsIndex = lines.findIndex((line) => /^##\s+Commands\s*$/.test(line));
  const commands = [];
  if (commandsIndex !== -1) {
    for (const line of lines.slice(commandsIndex + 1)) {
      if (line.startsWith("## ") || line.startsWith("# ")) break;
      for (const [, command] of line.matchAll(/`([^`]+)`/g)) {
        const name = scriptNameOf(command, workspaces);
        if (name && !commands.includes(name)) commands.push(name);
      }
    }
  }

  return { what, commands };
}

export function invariantProblems({ dir, claudeMd, instructions }) {
  const problems = [];

  if (!claudeMd.exists) {
    problems.push(`${dir}/CLAUDE.md is missing — run: ln -s AGENTS.md ${dir}/CLAUDE.md`);
  } else if (!claudeMd.isSymlink) {
    problems.push(`${dir}/CLAUDE.md is not a symlink — it must point at AGENTS.md, not duplicate it`);
  } else if (claudeMd.target !== "AGENTS.md") {
    problems.push(`${dir}/CLAUDE.md points at ${claudeMd.target}, expected AGENTS.md`);
  }

  if (!instructions.includes(`${dir}/AGENTS.md`)) {
    problems.push(`${dir}/AGENTS.md is missing from opencode.json instructions`);
  }

  return problems;
}

export function renderTable(rows) {
  return rows
    .map(({ dir, what, commands }) => {
      const [first, ...rest] = commands;
      const rendered = first
        ? [`\`npm run ${first}\``, ...rest.map((name) => `\`${name}\``)].join(" / ")
        : "none";
      return `| \`${dir}\` | ${what} | ${rendered} |`;
    })
    .join("\n");
}

export function replaceBlock(text, name, body) {
  const begin = beginMarker(name);
  const end = endMarker(name);
  const lines = text.split("\n");

  const found = [];
  let fenced = false;
  for (const [index, line] of lines.entries()) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const trimmed = line.trim();
    if (trimmed === begin) found.push({ marker: "begin", index });
    if (trimmed === end) found.push({ marker: "end", index });
  }

  const begins = found.filter((match) => match.marker === "begin");
  const ends = found.filter((match) => match.marker === "end");
  if (begins.length !== 1 || ends.length !== 1) {
    throw new Error(
      `expected exactly one ${begin} and one ${end}, found ${begins.length} and ${ends.length}`
    );
  }
  if (ends[0].index < begins[0].index) {
    throw new Error(`${end} appears before ${begin}: markers are out of order`);
  }

  return [
    ...lines.slice(0, begins[0].index + 1),
    ...body.split("\n"),
    ...lines.slice(ends[0].index),
  ].join("\n");
}
