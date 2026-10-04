import { SourcePausedError } from "../../domain/errors.js";
import type { BookCatalog } from "../../domain/ports.js";
import { nextUtcMidnight } from "./isbndbGate.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function capDailyCalls(catalog: BookCatalog, limit: number, now: () => number = Date.now): BookCatalog {
  let day = Math.floor(now() / DAY_MS);
  let calls = 0;
  return {
    ...catalog,
    async fetchDetails(lookup) {
      const at = now();
      if (Math.floor(at / DAY_MS) !== day) {
        day = Math.floor(at / DAY_MS);
        calls = 0;
      }
      if (calls >= limit) throw new SourcePausedError("isbndb", `background daily cap of ${limit} reached`, { retryAt: nextUtcMidnight(at) });
      calls++;
      return catalog.fetchDetails(lookup);
    }
  };
}
