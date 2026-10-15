import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({ options: { task: { type: "string" } }, allowPositionals: true });
const { answerEach, TASKS, scoreSynopses, scoreTranslations } = await import("../dist/modules/books/calibration.js");
const [samplePath, labelsPath] = positionals;
if (!TASKS.includes(values.task) || !samplePath || !labelsPath) {
  console.error(`Usage: node scripts/jev-calibration-score.mjs --task ${TASKS.join("|")} <sample.json> <labels.json>`);
  process.exit(1);
}
if (!process.env.TYPESAFE_API_KEY) {
  console.error("TYPESAFE_API_KEY is not set.");
  process.exit(1);
}

const sample = JSON.parse(readFileSync(samplePath, "utf8"));
const labels = JSON.parse(readFileSync(labelsPath, "utf8"));
const report = (skipped) => {
  if (skipped > 0) console.error(`${skipped} items got no usable answer from Jev and are left out of the score.`);
};
if (values.task === "translations") {
  const { createJevMatchClassifier } = await import("../dist/modules/books/adapters/typesafe/jevWorkMatch.js");
  const classify = createJevMatchClassifier(process.env.TYPESAFE_API_KEY, () => {});
  const { answers, skipped } = await answerEach(sample.filter((item) => item.stratum === "ask"), async (item) => {
    const answer = await classify({ edition: item.edition, candidates: item.candidates });
    return { workId: item.workId, pick: answer.choice === null ? null : item.candidates[answer.choice].id, confidence: answer.confidence };
  });
  report(skipped);
  console.log(JSON.stringify(scoreTranslations(sample, labels, answers), null, 2));
} else {
  const { createJevSynopsisClassifier } = await import("../dist/modules/books/adapters/typesafe/jevSynopsis.js");
  const classify = createJevSynopsisClassifier(process.env.TYPESAFE_API_KEY, () => {});
  const { answers, skipped } = await answerEach(sample.filter((item) => item.stratum !== "rule"), async (item) => {
    const answer = await classify({ title: item.title, author: item.author, text: item.text });
    return { hash: item.hash, usable: answer.usable, kind: answer.kind };
  });
  report(skipped);
  console.log(JSON.stringify(scoreSynopses(sample, labels, answers), null, 2));
}
