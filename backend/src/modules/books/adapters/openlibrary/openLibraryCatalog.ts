import { buildBookMetadata, findOpenLibraryMatch, mapOpenLibraryDoc, openLibraryDescription } from "@scripta/shared";
import { normalizeWorkKey } from "../../domain/normalize.js";
import { SourceUnavailableError } from "../../domain/errors.js";
import type { BookCatalog, EditionRecord, EditionRecordSource } from "../../domain/ports.js";
import { cleanWorkSubjects, type CleanedSubjects } from "../../domain/workSubjects.js";
import { parseSeriesString, seriesFromSubjects } from "../../domain/series.js";
import { fetchJson, type Throttle } from "../http/http.js";

const keyOf = (value: unknown): string | null => (value && typeof value === "object" && typeof (value as { key?: unknown }).key === "string" ? (value as { key: string }).key : null);

const subjectsOf = (work: unknown, match: Record<string, unknown>): unknown => (work && typeof work === "object" ? (work as { subjects?: unknown }).subjects : undefined) ?? match.subject;

export function parseEditionRecord(record: unknown): EditionRecord {
  const fields: Record<string, unknown> = record && typeof record === "object" ? (record as Record<string, unknown>) : {};
  const series = (Array.isArray(fields.series) ? fields.series : []).flatMap((value) => (typeof value === "string" ? parseSeriesString(value) ?? [] : []));
  return {
    title: typeof fields.title === "string" ? fields.title.trim() : "",
    workKey: Array.isArray(fields.works) ? keyOf(fields.works[0]) : null,
    languages: Array.isArray(fields.languages) ? fields.languages.flatMap((language) => keyOf(language) ?? []) : [],
    ...(series.length > 0 ? { series } : {})
  };
}

export type OpenLibraryWork = { key: string; title: string; authors: string[] };

export async function searchOpenLibraryWorks(throttle: Throttle, title: string, author: string): Promise<OpenLibraryWork[]> {
  const params = new URLSearchParams({ title, author, fields: "key,title,author_name", limit: "10" });
  const data = await throttle(() => fetchJson("openlibrary", `https://openlibrary.org/search.json?${params}`));
  const docs = data && typeof data === "object" ? (data as { docs?: unknown }).docs : undefined;
  if (!Array.isArray(docs)) return [];
  return docs.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const doc = item as { key?: unknown; title?: unknown; author_name?: unknown };
    if (typeof doc.key !== "string" || normalizeWorkKey(doc.key) === null || typeof doc.title !== "string" || doc.title === "") return [];
    const authors = Array.isArray(doc.author_name) ? doc.author_name.filter((name): name is string => typeof name === "string") : [];
    return [{ key: doc.key, title: doc.title, authors }];
  });
}

export async function fetchOpenLibrarySubjects(throttle: Throttle, keys: string[]): Promise<Map<string, CleanedSubjects>> {
  const params = new URLSearchParams({
    q: `key:(${keys.map((key) => `/works/${key}`).join(" OR ")})`,
    fields: "key,author_name,person,place,time,subject",
    limit: "100"
  });
  const data = await throttle(() => fetchJson("openlibrary", `https://openlibrary.org/search.json?${params}`));
  const docs = data && typeof data === "object" ? (data as { docs?: unknown }).docs : undefined;
  if (!Array.isArray(docs)) throw new SourceUnavailableError("openlibrary", "unreadable subjects batch");
  const found = new Map<string, CleanedSubjects>();
  for (const item of docs) {
    if (!item || typeof item !== "object") continue;
    const doc = item as Record<string, unknown>;
    const key = typeof doc.key === "string" ? normalizeWorkKey(doc.key) : null;
    if (key) found.set(key, cleanWorkSubjects({ people: doc.person, places: doc.place, times: doc.time, subjects: doc.subject, authors: doc.author_name }));
  }
  return found;
}

export function createOpenLibraryCatalog(throttle: Throttle, urgent = true): BookCatalog & EditionRecordSource {
  const get = (url: string) => throttle(() => fetchJson("openlibrary", url), { urgent });
  return {
    async fetchDetails({ isbn, title, author }) {
      if (!isbn && (!title || !author)) return null;
      const query = new URLSearchParams({ fields: "key,title,author_name,ratings_average,ratings_count,subject", limit: "5" });
      if (isbn) query.set("isbn", isbn);
      else {
        query.set("title", title);
        query.set("author", author);
      }
      const match = findOpenLibraryMatch(await get(`https://openlibrary.org/search.json?${query}`), isbn ?? "", title, author);
      if (!match) return null;
      const work = await get(`https://openlibrary.org${String(match.key)}.json`);
      const edition = isbn ? await get(`https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`) : null;
      const metadata = buildBookMetadata(match, work);
      const workSummary = metadata.summary;
      metadata.summary = openLibraryDescription(edition);
      const editionSeries = parseEditionRecord(edition).series;
      const subjectSeries = seriesFromSubjects(subjectsOf(work, match));
      const fields = work && typeof work === "object" ? (work as Record<string, unknown>) : null;
      const subjects = keyOf(fields?.type) === "/type/work"
        ? cleanWorkSubjects({ people: fields?.subject_people, places: fields?.subject_places, times: fields?.subject_times, subjects: subjectsOf(work, match), authors: match.author_name }).subjects
        : undefined;
      return {
        metadata,
        sources: ["openlibrary"],
        summarySource: metadata.summary ? "openlibrary" : null,
        workKey: String(match.key),
        workSummary,
        ...(editionSeries ? { editionSeries } : {}),
        ...(subjectSeries.length > 0 ? { subjectSeries } : {}),
        ...(subjects ? { subjects } : {})
      };
    },

    async search(query) {
      const params = new URLSearchParams({ fields: "key,title,author_name,first_publish_year,isbn,publisher,cover_i,subject", limit: "12" });
      if ("isbn" in query) params.set("isbn", query.isbn);
      else params.set("q", query.text);
      const data = await get(`https://openlibrary.org/search.json?${params}`);
      const docs = data && typeof data === "object" ? (data as { docs?: unknown }).docs : undefined;
      if (!Array.isArray(docs)) return [];
      return docs.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const doc = item as Record<string, unknown>;
        const result = mapOpenLibraryDoc(doc);
        const subjectSeries = seriesFromSubjects(doc.subject);
        return result ? [{ result, olCoverId: typeof doc.cover_i === "number" ? doc.cover_i : null, workKey: typeof doc.key === "string" ? doc.key : null, source: "openlibrary" as const, ...(subjectSeries.length > 0 ? { subjectSeries } : {}) }] : [];
      });
    },

    async fetchEditionRecord(isbn) {
      const record = await get(`https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`);
      return record === null ? null : parseEditionRecord(record);
    }
  };
}
