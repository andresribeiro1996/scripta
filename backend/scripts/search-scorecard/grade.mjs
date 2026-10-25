import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const [batchPath] = process.argv.slice(2);
if (!batchPath || !process.env.TYPESAFE_API_KEY) {
  console.error("Usage: TYPESAFE_API_KEY must be set; node grade.mjs <batch.json.gz>");
  process.exit(1);
}
const dist = `${process.cwd()}/backend/dist/modules/books/adapters/typesafe`;
const { askJev, realSleep } = await import(`${dist}/jevRequest.js`);
const { candidateLabel } = await import(`${dist}/jevWorkMatch.js`);
const QUESTION = {
  relevance: {
    type: "choice",
    instructions: "`query` is what a reader typed into a book search box. How does `book` relate to what they want?",
    criteria: {
      named: "It is what the query asks for: the titled book, a book of the named series, or a book by the named author",
      related: "It is about or bundles what the query asks for (an omnibus, box set, companion, guide, study or adaptation) but is not the book itself",
      unrelated: "It only shares words with the query"
    }
  }
};
const GRADES = new Set(["named", "related", "unrelated"]);
const batch = JSON.parse(gunzipSync(readFileSync(batchPath)).toString("utf8"));
const pairs = Object.entries(batch).flatMap(([q, candidates]) => candidates.map((candidate) => ({ q, candidate })));
let calls = 0;
let failed = 0;
async function grade({ q, candidate }) {
  try {
    const body = await askJev(process.env.TYPESAFE_API_KEY, () => calls++, realSleep, { query: q, book: candidateLabel(candidate) }, QUESTION);
    const answer = body?.answers?.relevance;
    if (!GRADES.has(answer?.choice) || typeof answer?.confidence !== "number") throw new Error("unexpected answer");
    console.log(JSON.stringify({ q, workId: candidate.workId, grade: answer.choice, confidence: answer.confidence }));
  } catch (error) {
    failed++;
    console.error(`failed ${JSON.stringify(q)} ${candidate.workId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
const queue = [...pairs];
await Promise.all(Array.from({ length: 6 }, async () => {
  for (let pair = queue.shift(); pair; pair = queue.shift()) await grade(pair);
}));
console.error(`pairs ${pairs.length}, calls ${calls}, failed ${failed}`);
if (failed > 0) process.exitCode = 1;
