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
