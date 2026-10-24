import { USER_AGENT } from "../http/http.js";
import { realSleep, type Sleep } from "../typesafe/jevRequest.js";

export type Binding = Record<string, { value: string } | undefined>;

export interface QueryOptions {
  log: (line: string) => void;
  sleep?: Sleep;
  signal?: AbortSignal;
}

export interface PagesOptions extends QueryOptions {
  onPage?: (offset: number, bindings: Binding[]) => void;
  query?: (query: string) => Promise<Binding[]>;
}

const WIKIDATA_URL = "https://query.wikidata.org/sparql";
export const WIKIDATA_PAGE_ROWS = 3000;
const WIKIDATA_TIMEOUT_MS = 90_000;
const WIKIDATA_ATTEMPTS = 3;
const WIKIDATA_RETRY_MS = 60_000;
const WIKIDATA_GAP_MS = 5_000;

export const listOf = (binding: Binding, name: string) => (binding[name]?.value ?? "").split("|").map((item) => item.trim()).filter(Boolean);

const isRetryable = (error: unknown): error is Error => error instanceof TypeError || error instanceof SyntaxError || (error instanceof Error && error.name === "TimeoutError");

export function reasonOf(error: Error): string {
  const cause = error.cause as { code?: string; message?: string } | undefined;
  return cause ? `${error.message} (${cause.code ?? cause.message})` : error.message;
}

export async function queryWikidata(query: string, { log, sleep = realSleep, signal }: QueryOptions): Promise<Binding[]> {
  for (let attempt = 1; ; attempt++) {
    signal?.throwIfAborted();
    let failure: Error;
    try {
      const timeout = AbortSignal.timeout(WIKIDATA_TIMEOUT_MS);
      const response = await fetch(WIKIDATA_URL, {
        method: "POST",
        headers: { "User-Agent": USER_AGENT, Accept: "application/sparql-results+json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ query }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout
      });
      if (response.ok) return ((await response.json()) as { results: { bindings: Binding[] } }).results.bindings;
      if (response.status !== 429 && response.status < 500) throw new Error(`Wikidata query failed: HTTP ${response.status}`);
      failure = new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (!isRetryable(error) || signal?.aborted) throw error;
      failure = error;
    }
    if (attempt === WIKIDATA_ATTEMPTS) throw new Error(`Wikidata query failed after ${attempt} attempts: ${reasonOf(failure)}`, { cause: failure });
    log(`wikidata attempt ${attempt} failed (${reasonOf(failure)}), retrying`);
    await sleep(WIKIDATA_RETRY_MS);
  }
}

export async function queryAllPages(
  page: (offset: number) => string,
  { log, sleep = realSleep, signal, onPage, query = (text) => queryWikidata(text, { log, sleep, signal }) }: PagesOptions
): Promise<Binding[]> {
  const all: Binding[] = [];
  for (let offset = 0, last = false; !last; offset += WIKIDATA_PAGE_ROWS) {
    await sleep(WIKIDATA_GAP_MS);
    const bindings = await query(page(offset));
    all.push(...bindings);
    onPage?.(offset, bindings);
    last = bindings.length < WIKIDATA_PAGE_ROWS;
  }
  return all;
}
