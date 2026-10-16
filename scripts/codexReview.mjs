export const MODES = {
  branch: { brief: "branch-review.md", usage: "branch <spec.md> [plan.md]" },
};

const SEVERITIES = [
  ["blocking", "Blocking"],
  ["should-fix", "Should fix"],
  ["follow-up", "Follow-ups"],
];

const FINDING_KEYS = ["severity", "file", "line", "summary", "scenario"];

export function parseReviewArgs(argv) {
  const [mode, spec, plan] = argv;
  if (!Object.hasOwn(MODES, mode)) throw new Error(`usage: codex-review.mjs ${MODES.branch.usage}`);
  if (!spec) throw new Error(`usage: codex-review.mjs ${MODES[mode].usage}`);
  return { mode, spec, plan };
}

export function buildPrompt(brief, { spec, plan }) {
  return [brief.trimEnd(), "", `Spec: ${spec}`, ...(plan ? [`Plan: ${plan}`] : [])].join("\n") + "\n";
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function events(jsonl) {
  return jsonl
    .split("\n")
    .filter((line) => line.trim())
    .map(parseJson)
    .filter((event) => event && typeof event === "object");
}

function innerMessage(message) {
  return parseJson(message)?.error?.message ?? message;
}

export function codexFailure(jsonl) {
  const all = events(jsonl);
  const failed = all.findLast((event) => event.type === "turn.failed");
  if (failed) return innerMessage(failed.error?.message ?? "the turn failed");
  if (all.some((event) => event.type === "turn.completed")) return null;
  const error = all.find((event) => event.type === "error");
  return error ? innerMessage(error.message ?? "codex reported an error") : null;
}

export function codexUsage(jsonl) {
  let model = null;
  const tokens = { input: 0, cached: 0, output: 0 };
  for (const event of events(jsonl)) {
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
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("the output must be a JSON object");
  for (const key of Object.keys(value)) {
    if (key !== "verdict" && key !== "findings") throw new Error(`unexpected key "${key}"`);
  }
  if (value?.verdict !== "pass" && value?.verdict !== "fail") throw new Error("verdict must be pass or fail");
  if (!Array.isArray(value.findings)) throw new Error("findings must be an array");
  for (const finding of value.findings) {
    for (const key of Object.keys(finding ?? {})) {
      if (!FINDING_KEYS.includes(key)) throw new Error(`a finding has an unexpected key "${key}"`);
    }
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
