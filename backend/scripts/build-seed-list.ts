import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { collectRanked } from "../src/modules/books/seed/fetchRankedWorks.js";
import { mergeSeedLists } from "../src/modules/books/seed/seedList.js";

const { values } = parseArgs({ options: { eng: { type: "string", default: "35000" }, por: { type: "string", default: "5000" }, out: { type: "string", default: "data/seed/seed-list.jsonl" } } });
const counts = { eng: Number(values.eng), por: Number(values.por) };
const log = (line: string) => console.error(line);

const merged = mergeSeedLists(await collectRanked("por", counts.por, log), await collectRanked("eng", counts.eng, log), counts);
mkdirSync(dirname(values.out), { recursive: true });
writeFileSync(values.out, merged.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
const por = merged.filter((entry) => entry.lang === "por").length;
console.error(`wrote ${merged.length} entries (${por} por, ${merged.length - por} eng) to ${values.out}`);
