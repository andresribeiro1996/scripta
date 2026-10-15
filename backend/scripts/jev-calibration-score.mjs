import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({ options: { task: { type: "string" } }, allowPositionals: true });
const { TASKS, scoreSynopses } = await import("../dist/modules/books/calibration.js");
const [samplePath, labelsPath] = positionals;
if (!TASKS.includes(values.task) || !samplePath || !labelsPath) {
  console.error(`Usage: node scripts/jev-calibration-score.mjs --task ${TASKS.join("|")} <sample.json> <labels.json>`);
  process.exit(1);
}
if (!process.env.TYPESAFE_API_KEY) {
  console.error("TYPESAFE_API_KEY is not set.");
  process.exit(1);
}

const { createJevSynopsisClassifier } = await import("../dist/modules/books/adapters/typesafe/jevSynopsis.js");
const sample = JSON.parse(readFileSync(samplePath, "utf8"));
const labels = JSON.parse(readFileSync(labelsPath, "utf8"));
const classify = createJevSynopsisClassifier(process.env.TYPESAFE_API_KEY, () => {});
const asked = sample.filter((item) => item.stratum !== "rule");
const answers = [];
let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < asked.length) {
    const item = asked[next++];
    const answer = await classify({ title: item.title, author: item.author, text: item.text });
    answers.push({ hash: item.hash, usable: answer.usable, kind: answer.kind });
  }
}));
console.log(JSON.stringify(scoreSynopses(sample, labels, answers), null, 2));
