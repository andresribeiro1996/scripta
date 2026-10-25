import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const USAGE = [
  "Usage: node scripts/fill-hardcover.mjs [--dry-run] [--skip <names.json>] [--after <rowid>] [--max-requests <n>]",
  "       node scripts/fill-hardcover.mjs --remove <names.json>"
].join("\n");

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

let values;
try {
  ({ values } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      skip: { type: "string" },
      after: { type: "string" },
      "max-requests": { type: "string" },
      remove: { type: "string" }
    }
  }));
} catch (error) {
  if (!error.code?.startsWith("ERR_PARSE_ARGS_")) throw error;
  fail(`${error.message}\n${USAGE}`);
}

const remove = values.remove !== undefined;
if (remove && (values["dry-run"] || values.skip !== undefined || values.after !== undefined || values["max-requests"] !== undefined)) fail(USAGE);

const missing = ["COVERS_DB_PATH", ...(remove ? [] : ["HARDCOVER_API_TOKEN"])].find((name) => !process.env[name]);
if (missing) fail(`Missing environment variable: ${missing}`);

const dryRun = values["dry-run"];
if (!remove && !dryRun && values.skip === undefined) {
  fail("A real Hardcover fill needs --skip <names.json>: run --dry-run --max-requests 500, review seriesNames, then pass the rejected names (or a file holding []).");
}

const whole = (name, text) => {
  if (!/^\d+$/.test(text)) fail(`${name} must be a whole number, got "${text}"\n${USAGE}`);
  return Number(text);
};
const after = values.after === undefined ? 0 : whole("--after", values.after);
const maxRequests = values["max-requests"] === undefined ? null : whole("--max-requests", values["max-requests"]);

const { openBooksDb } = await import("../dist/modules/books/adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../dist/modules/books/adapters/sqlite/sqliteBooksRepository.js");
const { createHardcoverLookup } = await import("../dist/modules/books/adapters/hardcover/hardcover.js");
const { seriesNameKey } = await import("../dist/modules/books/domain/series.js");
const { waitForBnpLock } = await import("../dist/modules/books/seed/bnpImport.js");
const { fillFromHardcover } = await import("../dist/modules/books/seed/hardcoverFill.js");

function namesIn(path) {
  const names = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(names) || !names.every((name) => typeof name === "string")) fail(`${path} must hold a JSON array of series names`);
  return names;
}

if (remove) {
  const keys = namesIn(values.remove).flatMap((name) => seriesNameKey(name) ?? []);
  const repo = createSqliteBooksRepository(waitForBnpLock(openBooksDb()));
  console.log(JSON.stringify({ removed: repo.removeWorkSeries(keys, "hardcover") }, null, 2));
  process.exit(0);
}

const skipNameKeys = new Set(values.skip === undefined ? [] : namesIn(values.skip).map(seriesNameKey).filter(Boolean));
const db = dryRun ? new DatabaseSync(process.env.COVERS_DB_PATH, { readOnly: true }) : waitForBnpLock(openBooksDb());
const repo = createSqliteBooksRepository(db);
const report = await fillFromHardcover(
  { repo, lookup: createHardcoverLookup(process.env.HARDCOVER_API_TOKEN), now: () => new Date(), log: (line) => console.error(line) },
  { dryRun, skipNameKeys, after, maxRequests }
);
console.log(JSON.stringify(report, null, 2));
process.exit(report.stoppedBy === "error" ? 1 : 0);
