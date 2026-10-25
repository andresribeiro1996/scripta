const LABEL_LIMIT = 60;
const MIN_TARGET_PX = 44;
const HEIGHT = 900;
const STEP_FLAGS = new Set(["--click", "--click-at", "--fill", "--press", "--wait"]);

function clip(value) {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > LABEL_LIMIT ? `${flat.slice(0, LABEL_LIMIT - 1)}…` : flat;
}

function parseStep(flag, value) {
  if (flag === "--click") {
    const split = value.indexOf(":");
    if (split === -1) throw new Error(`--click needs "<role>:<name>", got "${value}"`);
    return { kind: "click", role: value.slice(0, split), name: value.slice(split + 1) };
  }
  if (flag === "--click-at") {
    const match = value.match(/^(\d+),(\d+)$/);
    if (!match) throw new Error(`--click-at needs "<x>,<y>" integers, got "${value}"`);
    return { kind: "clickAt", x: Number(match[1]), y: Number(match[2]) };
  }
  if (flag === "--fill") {
    const split = value.indexOf("=");
    if (split === -1) throw new Error(`--fill needs "<label>=<text>", got "${value}"`);
    return { kind: "fill", label: value.slice(0, split), text: value.slice(split + 1) };
  }
  if (flag === "--press") return { kind: "press", key: value };
  return { kind: "wait", text: value };
}

export function parseWebSnapshotArgs(argv) {
  const args = { name: undefined, out: undefined, path: "/", width: 1280, signedOut: false, steps: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      if (args.name !== undefined) throw new Error(`unexpected argument "${arg}"`);
      args.name = arg;
      continue;
    }
    if (arg === "--signed-out") {
      args.signedOut = true;
      continue;
    }
    const known = arg === "--out" || arg === "--path" || arg === "--width" || STEP_FLAGS.has(arg);
    if (!known) throw new Error(`unknown flag ${arg}`);
    const value = argv[++i];
    if (value === undefined) throw new Error(`${arg} needs a value`);
    if (arg === "--out") args.out = value;
    else if (arg === "--path") args.path = value;
    else if (arg === "--width") {
      args.width = Number(value);
      if (!Number.isInteger(args.width) || args.width <= 0) throw new Error(`--width needs a positive integer, got "${value}"`);
    } else args.steps.push(parseStep(arg, value));
  }
  if (!args.name) throw new Error("usage: node scripts/web-snapshot.mjs <name> --out <dir> [--path /route] [--width N] [--signed-out] [steps]");
  if (!args.out) throw new Error("--out <dir> is required");
  return args;
}

function elementRow({ role, name, x, y, w, h, href, disabled, coveredBy }) {
  const label = name ? `"${clip(name)}"` : "(no label)";
  const parts = [`  ${role} ${label}`, `@${x},${y}  ${w}×${h}px`];
  if (href) parts.push(`→ ${href}`);
  if (Math.floor(Math.min(w, h)) < MIN_TARGET_PX) parts.push("⚠ <44px");
  if (disabled) parts.push("(disabled)");
  if (coveredBy !== undefined) parts.push(`⚠ under "${clip(coveredBy)}"`);
  return parts.join("  ");
}

export function formatWebListing({ name, pngPath, width, height = HEIGHT, headings, elements, consoleErrors, failedRequests, note }) {
  const header = `${name} · ${width}×${height}px · saved ${pngPath}${note ? ` · ${note}` : ""}`;
  const lines = [header];
  for (const { level, text } of headings) lines.push(`  h${level} "${clip(text)}"`);
  for (const element of elements) lines.push(elementRow(element));
  if (consoleErrors.length) lines.push(`console errors (${consoleErrors.length}):`, ...consoleErrors.map((e) => `  ${e}`));
  if (failedRequests.length) lines.push(`failed requests (${failedRequests.length}):`, ...failedRequests.map((r) => `  ${r}`));
  return lines.join("\n");
}

export function sessionState(origin, loginBody) {
  return { cookies: [], origins: [{ origin, localStorage: [{ name: "kobo_session", value: JSON.stringify(loginBody) }] }] };
}
