import { coverQueryKey, type CoverLookupParams } from "./coverResolver.js";

export const COVER_MIN_ASPECT_RATIO = 1.2;
export const COVER_MAX_ASPECT_RATIO = 1.9;
const ISBNDB_PLACEHOLDER = { width: 200, height: 248 };

export function isAcceptableCover(source: string, width: number, height: number): boolean {
  const ratio = height / width;
  if (ratio < COVER_MIN_ASPECT_RATIO || ratio > COVER_MAX_ASPECT_RATIO) return false;
  return !(source === "isbndb" && width === ISBNDB_PLACEHOLDER.width && height === ISBNDB_PLACEHOLDER.height);
}

export type CoverPickSource = "quick" | "apple";

export interface CoverCandidateView {
  source: string;
  url: string;
  fullUrl: string;
  coverImageId: string | null;
  width: number | null;
  height: number | null;
}

export interface CoverCandidatesResponse {
  candidates: CoverCandidateView[];
  unavailable: string[];
}

export type CoverChoice = { coverImageId: string } | { url: string };

export function coverCandidatesQuery(params: CoverLookupParams, from: CoverPickSource): string {
  const query = coverQueryKey(params);
  return from === "apple" ? `${query}&from=apple` : query;
}

export function pickCoverBody(
  params: CoverLookupParams,
  choice: CoverChoice,
  everyone: boolean
): { isbn?: string; title?: string; author?: string; coverImageId?: string; url?: string; everyone?: true } {
  const { isbn, title, author } = params;
  return {
    ...(isbn ? { isbn } : {}),
    ...(title ? { title } : {}),
    ...(author ? { author } : {}),
    ...choice,
    ...(everyone ? { everyone: true as const } : {})
  };
}

export type MeasuredCoverSize = { width: number; height: number } | null;

export function visibleCandidates(
  candidates: CoverCandidateView[],
  measured: ReadonlyMap<string, MeasuredCoverSize>
): Array<{ candidate: CoverCandidateView; width: number | null; height: number | null }> {
  const shown: Array<{ candidate: CoverCandidateView; width: number | null; height: number | null }> = [];
  for (const candidate of candidates) {
    if (candidate.coverImageId !== null) {
      shown.push({ candidate, width: candidate.width, height: candidate.height });
      continue;
    }
    const size = measured.get(candidate.url);
    if (size === undefined) shown.push({ candidate, width: null, height: null });
    else if (size && size.width > 0 && size.height > 0 && isAcceptableCover(candidate.source, size.width, size.height)) {
      shown.push({ candidate, width: size.width, height: size.height });
    }
  }
  return shown;
}

export type FoundCoversLoad =
  | { state: "pending" }
  | { state: "done"; response: CoverCandidatesResponse }
  | { state: "failed"; message: string };

export const FOUND_COVERS_PENDING: FoundCoversLoad = { state: "pending" };

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function foundCoversView(quick: FoundCoversLoad, apple: FoundCoversLoad, measured: ReadonlyMap<string, MeasuredCoverSize>) {
  const loads = [quick, apple];
  const tiles = visibleCandidates(
    loads.flatMap((load) => (load.state === "done" ? load.response.candidates : [])),
    measured
  );
  const unavailable = [...new Set(loads.flatMap((load) => (load.state === "done" ? load.response.unavailable : [])))];
  const failures = [...new Set(loads.flatMap((load) => (load.state === "failed" ? [load.message] : [])))];
  const checkingApple = apple.state === "pending";
  const empty = tiles.length === 0 && unavailable.length === 0 && failures.length === 0 && !checkingApple;
  return { tiles, unavailable, failures, checkingApple, empty };
}

export function isCurrentCover(candidate: CoverCandidateView, coverUrl: unknown): boolean {
  return typeof coverUrl === "string" && coverUrl !== "" && (coverUrl === candidate.url || coverUrl === candidate.fullUrl);
}

const SOURCE_LABELS = new Map([
  ["kobo", "Kobo"],
  ["isbndb", "ISBNdb"],
  ["openlibrary", "Open Library"],
  ["apple", "Apple Books"],
  ["bnp", "National Library of Portugal"],
  ["publisher", "Publisher"],
  ["upload", "Admin upload"]
]);

export function coverSourceLabel(source: string): string {
  return SOURCE_LABELS.get(source) ?? source;
}
