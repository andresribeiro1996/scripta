import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { origin: { type: "string" }, since: { type: "string" }, apply: { type: "boolean", default: false } } });
if (!values.origin || !values.since || !values.since.endsWith("Z") || Number.isNaN(Date.parse(values.since))) {
  console.error("usage: node scripts/reset-publisher-covers.mjs --origin <https://…> --since <ISO time in UTC, ending in Z> [--apply]");
  process.exit(1);
}

const { openBooksDb } = await import("../dist/modules/books/adapters/sqlite/connection.js");
const { resetPublisherCovers } = await import("../dist/modules/books/seed/resetPublisherCovers.js");

const report = resetPublisherCovers(
  { db: openBooksDb(), now: () => new Date() },
  { origin: values.origin, since: new Date(values.since).toISOString(), apply: values.apply }
);
console.log(JSON.stringify({ apply: values.apply, ...report }));
