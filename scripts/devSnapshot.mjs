import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { androidEnv } from "./androidSdk.mjs";
import { decodeEntities, parseScreenText, readScreenText } from "./devWait.mjs";

const MIN_TARGET_DP = 44;
const LABEL_LIMIT = 60;
const STILL_CHANGING = " · screen was still changing — snapshot again";
const MAX_SIDE = 1200;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngSize(png) {
  if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error(`screencap returned ${png.length} bytes, not a PNG`);
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

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
  return [node.text, ...node.children.filter((child) => !child.clickable).flatMap(innerText)].filter((text) => text.trim());
}

function tapLabel(node) {
  if (node.desc.trim()) return `desc="${clip(node.desc)}"`;
  const texts = innerText(node);
  return texts.length ? `"${clip(texts.join(" · "))}"` : "(no label)";
}

const centreOf = ([x1, y1, x2, y2]) => [Math.round((x1 + x2) / 2), Math.round((y1 + y2) / 2)];

function listTaps(node, taps) {
  const [x1, y1, x2, y2] = node.bounds;
  if (x2 <= x1 || y2 <= y1) return;
  const tap = node.clickable ? { node, end: 0 } : undefined;
  if (tap) taps.push(tap);
  for (const child of node.children) listTaps(child, taps);
  if (tap) tap.end = taps.length;
}

function findCovers(roots) {
  const taps = [];
  for (const root of roots) listTaps(root, taps);
  return new Map(
    taps.map((tap) => {
      const [cx, cy] = centreOf(tap.node.bounds);
      const cover = taps.slice(tap.end).findLast(({ node: { bounds: [x1, y1, x2, y2] } }) => cx >= x1 && cx < x2 && cy >= y1 && cy < y2);
      return [tap.node, cover?.node];
    }),
  );
}

function tapRow(node, density, cover) {
  const [x1, y1, x2, y2] = node.bounds;
  const width = toDp(x2 - x1, density);
  const height = toDp(y2 - y1, density);
  const small = width < MIN_TARGET_DP || height < MIN_TARGET_DP ? "  ⚠ <44dp" : "";
  const disabled = node.enabled ? "" : "  (disabled)";
  const under = cover ? `  ⚠ under ${tapLabel(cover)}` : "";
  return `  tap ${centreOf(node.bounds).join(",")}  ${tapLabel(node)}  ${Math.floor(width)}×${Math.floor(height)}dp${small}${disabled}${under}`;
}

function textRow(node) {
  const text = clip(node.text);
  const desc = clip(node.desc);
  if (text) return `  · "${text}"`;
  return desc ? `  · desc="${desc}"` : undefined;
}

function collectRows(node, density, insideTap, covers, rows) {
  const [x1, y1, x2, y2] = node.bounds;
  if (x2 <= x1 || y2 <= y1) return;
  if (node.clickable) rows.push(tapRow(node, density, covers.get(node)));
  else if (!insideTap) {
    const row = textRow(node);
    if (row) rows.push(row);
  }
  for (const child of node.children) collectRows(child, density, insideTap || node.clickable, covers, rows);
}

export function formatListing({ name, pngPath, xml, density, note = "" }) {
  const roots = parseHierarchy(xml);
  const [x1, y1, x2, y2] = roots[0]?.bounds ?? [0, 0, 0, 0];
  const header = `${name} · ${Math.round(toDp(x2 - x1, density))}×${Math.round(toDp(y2 - y1, density))}dp · saved ${pngPath}${note}`;
  const covers = findCovers(roots);
  const rows = [];
  for (const root of roots) collectRows(root, density, false, covers, rows);
  return [header, ...rows].join("\n");
}

function runTool(command, args, options) {
  return execFileSync(command, args, { env: { ...process.env, ...androidEnv() }, maxBuffer: 64 * 1024 * 1024, ...options });
}

export function takeSnapshot(serial, name, outDir, { exec = runTool, read = readScreenText } = {}) {
  const adb = (args, options) => exec("adb", ["-s", serial, ...args], options);
  mkdirSync(outDir, { recursive: true });
  const pngPath = join(outDir, `${name}.png`);
  const before = read(serial) || read(serial);
  const png = adb(["exec-out", "screencap", "-p"]);
  const longSide = Math.max(...pngSize(png));
  writeFileSync(pngPath, png);
  if (longSide > MAX_SIDE) exec("sips", ["-Z", String(MAX_SIDE), pngPath], { stdio: "ignore" });
  if (!before) return `${name} · dump failed — screenshot only · saved ${pngPath}`;
  const density = parseDensity(adb(["shell", "wm", "density"], { encoding: "utf8" }));
  const after = read(serial);
  const changing = after && JSON.stringify(parseScreenText(before)) !== JSON.stringify(parseScreenText(after));
  return formatListing({ name, pngPath, xml: after || before, density, note: changing ? STILL_CHANGING : "" });
}

export function parseSnapshotArgs(argv) {
  const outFlag = argv.indexOf("--out");
  const outDir = outFlag === -1 ? undefined : argv[outFlag + 1];
  const name = argv.find((arg, index) => !arg.startsWith("--") && (outFlag === -1 || index !== outFlag + 1));
  if (!name || !outDir || outDir.startsWith("--")) throw new Error("usage: npm run dev:snapshot -- <name> --out <dir>");
  return { name, outDir };
}
