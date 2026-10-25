import { PRIZES, type PrizeKey } from "@scripta/shared";
import type { Sleep } from "../adapters/typesafe/jevRequest.js";
import { WIKIDATA_PAGE_ROWS, listOf, queryAllPages, type Binding } from "../adapters/wikidata/sparql.js";
import { PRIZE_ITEMS } from "../domain/awards.js";
import type { BooksRepository } from "../domain/ports.js";
import { inBatches, matchWorkIds } from "./wikidataMatch.js";

export interface AwardRow {
  isbns: string[];
  olWorkIds: string[];
  prize: PrizeKey;
  year: number;
  won: boolean;
  honoree: string | null;
}

export interface PrizeTally {
  rows: number;
  works: number;
  won: number;
  nominated: number;
}

export interface AwardsRefreshDeps {
  repo: Pick<BooksRepository, "transaction" | "findBookByKey" | "workIdsByWorkKeys" | "addWorkAward">;
  query: (query: string) => Promise<Binding[]>;
  fetchWork: (olWorkKey: string) => Promise<unknown>;
  now: () => number;
  info: (fields: object, message: string) => void;
  sleep?: Sleep;
}

const PRIZE_KEYS = Object.keys(PRIZE_ITEMS) as PrizeKey[];
const PRIZE_OF_ITEM = new Map(PRIZE_KEYS.map((key) => [PRIZE_ITEMS[key], key]));
const EDITION_CLASS = "wd:Q3331189";
const BOOK_PRIZE_PAIRS = "VALUES (?p ?ps ?won) { (p:P166 ps:P166 true) (p:P1411 ps:P1411 false) }";

const KINDS = [
  { name: "openlibrary", ids: "olIds", where: '?work wdt:P648 ?id . FILTER(REGEX(?id, "^OL[0-9]+W$"))' },
  { name: "isbn", ids: "isbns", where: `?work (wdt:P212|wdt:P957) ?id . FILTER NOT EXISTS { ?work wdt:P31 ${EDITION_CLASS} }` },
  { name: "edition-isbn", ids: "isbns", where: "?edition wdt:P629 ?work . ?edition (wdt:P212|wdt:P957) ?id ." }
];

const SHAPES = [
  { name: "on-work", honours: "work", where: `${BOOK_PRIZE_PAIRS} ?work ?p ?statement . ?statement ?ps ?prize .` },
  { name: "on-author", honours: "work", where: `${BOOK_PRIZE_PAIRS} ?person ?p ?statement . ?statement ?ps ?prize ; pq:P1686 ?work .` },
  { name: "on-prize", honours: "work", where: "?prize p:P1346 ?statement . ?statement pq:P1686 ?work . BIND(true AS ?won)" },
  { name: "author-prize", honours: "author", where: "?person p:P166 ?statement . ?statement ps:P166 ?prize . ?work wdt:P50 ?person . BIND(true AS ?won)" }
] as const;

export const itemOf = (uri: string) => uri.slice(uri.lastIndexOf("/") + 1);

const yearClause = (minYear: number | undefined) =>
  minYear === undefined
    ? "OPTIONAL { ?statement pq:P585 ?when . } BIND(YEAR(?when) AS ?year)"
    : `?statement pq:P585 ?when . BIND(YEAR(?when) AS ?year) FILTER(?year >= ${minYear})`;

function pageOf(shape: (typeof SHAPES)[number], kind: (typeof KINDS)[number], minYear: number | undefined, offset: number): string {
  const prizes = PRIZE_KEYS.filter((key) => PRIZES[key].honours === shape.honours).map((key) => `wd:${PRIZE_ITEMS[key]}`);
  const group = shape.honours === "author" ? "?work ?person ?prize ?won ?year" : "?work ?prize ?won ?year";
  return `
SELECT ${group} (GROUP_CONCAT(DISTINCT ?id; separator="|") AS ?${kind.ids}) WHERE {
  ${shape.where} VALUES ?prize { ${prizes.join(" ")} } ${kind.where} ${yearClause(minYear)}
}
GROUP BY ${group}
ORDER BY ${group}
LIMIT ${WIKIDATA_PAGE_ROWS} OFFSET ${offset}`;
}

export function awardQueries(minYear?: number): Array<{ kind: string; page: (offset: number) => string }> {
  return SHAPES.flatMap((shape) => KINDS.map((kind) => ({ kind: `${shape.name}/${kind.name}`, page: (offset: number) => pageOf(shape, kind, minYear, offset) })));
}

const honoreeLabelsQuery = (people: string[]) => `
SELECT ?person (SAMPLE(?enLabel) AS ?en) (SAMPLE(?ptLabel) AS ?pt) (SAMPLE(?anyLabel) AS ?any) WHERE {
  VALUES ?person { ${people.map((id) => `wd:${id}`).join(" ")} }
  OPTIONAL { ?person rdfs:label ?enLabel . FILTER(LANG(?enLabel) = "en") }
  OPTIONAL { ?person rdfs:label ?ptLabel . FILTER(LANGMATCHES(LANG(?ptLabel), "pt")) }
  OPTIONAL { ?person rdfs:label ?anyLabel . }
}
GROUP BY ?person`;

export async function honoreeLabels(query: (query: string) => Promise<Binding[]>, bindings: Binding[]): Promise<Map<string, string>> {
  const people = [...new Set(bindings.flatMap((binding) => (binding.person ? [itemOf(binding.person.value)] : [])))];
  if (people.length === 0) return new Map();
  const labels = new Map<string, string>();
  for (const binding of await query(honoreeLabelsQuery(people))) {
    const label = [binding.en, binding.pt, binding.any].map((found) => found?.value.trim() ?? "").find(Boolean);
    if (binding.person && label) labels.set(itemOf(binding.person.value), label);
  }
  return labels;
}

export function awardRowsOf(bindings: Binding[], honorees: ReadonlyMap<string, string> = new Map()): { rows: AwardRow[]; noYear: Partial<Record<PrizeKey, number>> } {
  const rows: AwardRow[] = [];
  const noYear: Partial<Record<PrizeKey, number>> = {};
  for (const binding of bindings) {
    const prize = binding.prize && PRIZE_OF_ITEM.get(itemOf(binding.prize.value));
    if (!prize) continue;
    const year = Number.parseInt(binding.year?.value ?? "", 10);
    if (!Number.isInteger(year)) {
      noYear[prize] = (noYear[prize] ?? 0) + 1;
      continue;
    }
    rows.push({
      isbns: listOf(binding, "isbns"),
      olWorkIds: listOf(binding, "olIds"),
      prize,
      year,
      won: binding.won?.value === "true",
      honoree: (binding.person && honorees.get(itemOf(binding.person.value))) || null
    });
  }
  return { rows, noYear };
}

export async function fillAwards(
  repo: Pick<BooksRepository, "transaction" | "findBookByKey" | "workIdsByWorkKeys" | "addWorkAward">,
  fetchWork: (olWorkKey: string) => Promise<unknown>,
  rows: AwardRow[],
  at: string,
  { dryRun }: { dryRun: boolean }
): Promise<{ matched: number; added: number; redirected: number; failedKeys: string[]; prizes: Record<PrizeKey, PrizeTally> }> {
  const { workIds, redirected, failedKeys } = await matchWorkIds(repo, fetchWork, rows);
  const writes = new Map<string, { workId: string; prize: PrizeKey; year: number; won: boolean; honoree: string | null }>();
  for (const [index, row] of rows.entries()) {
    for (const workId of workIds[index]!) {
      const key = `${workId}|${row.prize}|${row.year}`;
      const known = writes.get(key);
      if (known === undefined) {
        writes.set(key, { workId, prize: row.prize, year: row.year, won: row.won, honoree: row.honoree });
        continue;
      }
      known.won ||= row.won;
      known.honoree ??= row.honoree;
    }
  }
  const prizes = Object.fromEntries(
    PRIZE_KEYS.map((key) => {
      const own = [...writes.values()].filter((write) => write.prize === key);
      return [key, {
        rows: rows.filter((row) => row.prize === key).length,
        works: new Set(own.map((write) => write.workId)).size,
        won: own.filter((write) => write.won).length,
        nominated: own.filter((write) => !write.won).length
      }];
    })
  ) as Record<PrizeKey, PrizeTally>;
  const added = dryRun ? 0 : await inBatches(repo, [...writes.values()], (write) => repo.addWorkAward(write, at));
  return { matched: writes.size, added, redirected, failedKeys, prizes };
}

export async function refreshAwards({ repo, query, fetchWork, now, info, sleep }: AwardsRefreshDeps, signal: AbortSignal): Promise<void> {
  const at = new Date(now());
  const bindings: Binding[] = [];
  for (const { page } of awardQueries(at.getUTCFullYear() - 1)) {
    signal.throwIfAborted();
    bindings.push(...(await queryAllPages(page, { log: (line) => info({}, line), sleep, query })));
  }
  const { rows } = awardRowsOf(bindings, await honoreeLabels(query, bindings));
  const { matched, added, redirected, failedKeys } = await fillAwards(repo, fetchWork, rows, at.toISOString(), { dryRun: false });
  info({ rows: rows.length, matched, added, redirected, failedKeys: failedKeys.length }, "awards refresh");
}
