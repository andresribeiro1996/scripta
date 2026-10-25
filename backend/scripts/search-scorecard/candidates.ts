import { scorecardCandidates } from "../../src/modules/books/scorecard.js";
import queries from "./queries.json" with { type: "json" };
import { readonlyRepo } from "./readonlyRepo.js";

const { repo } = readonlyRepo();
const out: Record<string, ReturnType<typeof scorecardCandidates>> = {};
for (const { q } of queries) out[q] = scorecardCandidates(repo, q);
console.log(JSON.stringify(out));
