#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, errors } from "playwright";
import { portsFromEnvLocal, webUrls } from "./devWeb.mjs";
import { mobileCertsExist } from "./mobileCertPaths.mjs";
import { formatWebListing, parseWebSnapshotArgs } from "./webSnapshot.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const HEIGHT = 900;
const STILL_CHANGING = "page was still changing — snapshot again";

function collectPage() {
  const INTERACTIVE = 'a[href], button, input, select, textarea, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=switch], [tabindex]:not([tabindex="-1"])';
  const text = (node) => (node?.innerText ?? node?.textContent ?? "").replace(/\s+/g, " ").trim();
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  };
  const roleOf = (el) => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "button") return "button";
    if (tag === "input") {
      const type = (el.getAttribute("type") ?? "text").toLowerCase();
      if (type === "checkbox" || type === "radio") return type;
      if (["button", "submit", "reset", "image"].includes(type)) return "button";
      return type === "range" ? "slider" : "textbox";
    }
    return "generic";
  };
  const nameOf = (el) => {
    const aria = el.getAttribute("aria-label");
    if (aria?.trim()) return aria.trim();
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const labelled = by.split(/\s+/).map((id) => text(document.getElementById(id))).filter(Boolean).join(" ");
      if (labelled) return labelled;
    }
    const label = el.labels?.length ? [...el.labels].map(text).filter(Boolean).join(" ") : "";
    if (label) return label;
    return text(el) || el.getAttribute("title")?.trim() || "";
  };
  const elements = [];
  for (const el of document.querySelectorAll(INTERACTIVE)) {
    if (!visible(el)) continue;
    const rect = el.getBoundingClientRect();
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);
    const row = { role: roleOf(el), name: nameOf(el), x, y, w: Math.round(rect.width), h: Math.round(rect.height) };
    if (el.tagName === "A" && el.getAttribute("href")) row.href = el.getAttribute("href");
    if (el.disabled === true || el.getAttribute("aria-disabled") === "true") row.disabled = true;
    if (x >= 0 && y >= 0 && x < innerWidth && y < innerHeight) {
      const hit = document.elementFromPoint(x, y);
      if (hit && !el.contains(hit)) {
        const cover = hit.closest(INTERACTIVE);
        if (cover && cover !== el) row.coveredBy = nameOf(cover);
      }
    }
    elements.push(row);
  }
  const headings = [...document.querySelectorAll("h1, h2, h3")]
    .filter(visible)
    .map((el) => ({ level: Number(el.tagName[1]), text: text(el) }));
  return { headings, elements };
}

async function login(request, api, account) {
  const response = await request.post(`${api}/auth/login`, { data: { identifier: account.username, password: account.password } });
  if (!response.ok()) throw new Error(`POST ${api}/auth/login answered ${response.status()}`);
  const { user, accessToken, refreshToken } = await response.json();
  return { user, accessToken, refreshToken };
}

async function settleIdle(page) {
  try {
    await page.waitForLoadState("networkidle", { timeout: 10000 });
  } catch (error) {
    if (!(error instanceof errors.TimeoutError)) throw error;
  }
}

async function runStep(page, step) {
  if (step.kind === "click") await page.getByRole(step.role, { name: step.name, exact: true }).click({ timeout: 10000 });
  else if (step.kind === "clickAt") await page.mouse.click(step.x, step.y);
  else if (step.kind === "fill") {
    const byLabel = page.getByLabel(step.label, { exact: true });
    const target = (await byLabel.count()) > 0 ? byLabel : page.getByPlaceholder(step.label, { exact: true });
    await target.fill(step.text, { timeout: 10000 });
  } else if (step.kind === "press") await page.keyboard.press(step.key);
  else await page.getByText(step.text).first().waitFor({ timeout: 15000 });
  if (step.kind === "click" || step.kind === "clickAt") await settleIdle(page);
}

function describeStep(step) {
  if (step.kind === "click") return `--click "${step.role}:${step.name}"`;
  if (step.kind === "clickAt") return `--click-at ${step.x},${step.y}`;
  if (step.kind === "fill") return `--fill "${step.label}=…"`;
  if (step.kind === "press") return `--press ${step.key}`;
  return `--wait "${step.text}"`;
}

async function settleScreen(page) {
  try {
    await page.waitForFunction(() => document.getAnimations().length === 0, undefined, { timeout: 5000 });
  } catch (error) {
    if (!(error instanceof errors.TimeoutError)) throw error;
  }
  let previous = await page.screenshot();
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.waitForTimeout(500);
    const next = await page.screenshot();
    if (next.equals(previous)) return "";
    previous = next;
  }
  return STILL_CHANGING;
}

async function main() {
  const args = parseWebSnapshotArgs(process.argv.slice(2));
  const out = resolve(args.out);
  mkdirSync(out, { recursive: true });
  const { vitePort, apiPort } = portsFromEnvLocal(readFileSync(join(repoRoot, "frontend", ".env.local"), "utf8"));
  const { web, api } = webUrls({ vitePort, apiPort, https: mobileCertsExist() });
  const sessionPath = join(out, "session.json");
  const pngPath = join(out, `${args.name}.png`);
  const account = JSON.parse(readFileSync(join(repoRoot, "scripts", "fixtures", "account.json"), "utf8"));
  const saveSession = (state) => writeFileSync(sessionPath, JSON.stringify(state), { mode: 0o600 });

  const storageState = !args.signedOut && existsSync(sessionPath) ? sessionPath : undefined;

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: args.width, height: HEIGHT }, ignoreHTTPSErrors: web.startsWith("https:"), serviceWorkers: "block", storageState });
  const page = await context.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) failedRequests.push(`${response.request().method()} ${response.status()} ${new URL(response.url()).pathname}`);
  });
  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText !== "net::ERR_ABORTED") failedRequests.push(`${request.method()} failed ${new URL(request.url()).pathname}`);
  });

  let failure;
  let note = "";
  let collected = { headings: [], elements: [] };
  try {
    try {
      await page.goto(web + args.path, { waitUntil: "networkidle" });
      if (!args.signedOut && !(await page.evaluate(() => localStorage.getItem("kobo_session") !== null))) {
        const body = await login(context.request, api, account);
        await page.evaluate((value) => localStorage.setItem("kobo_session", value), JSON.stringify(body));
        await page.goto(web + args.path, { waitUntil: "networkidle" });
      }
    } catch (error) {
      failure = `loading ${args.path} failed: ${error.message}`;
    }
    for (const [index, step] of args.steps.entries()) {
      if (failure) break;
      try {
        await runStep(page, step);
      } catch (error) {
        failure = `step ${index + 1} (${describeStep(step)}) failed: ${error.message}`;
      }
    }
    note = await settleScreen(page);
    collected = await page.evaluate(collectPage);
    await page.screenshot({ path: pngPath, fullPage: true });
  } finally {
    try {
      if (!args.signedOut) saveSession(await context.storageState());
    } finally {
      await browser.close();
    }
  }
  console.log(formatWebListing({ name: args.name, pngPath, width: args.width, height: HEIGHT, ...collected, consoleErrors, failedRequests, note }));
  if (failure) {
    console.error(`[web-snapshot] ${failure}`);
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  console.error(`[web-snapshot] ${error.message}`);
  process.exitCode = 1;
}
