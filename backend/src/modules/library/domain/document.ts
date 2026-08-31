// Pure mapping between the library DOCUMENT (the JSON shape the frontend
// and the exporter speak) and the ENTITIES the repository stores.
//
// Deliberately free of SQL and of any I/O, so the round trip can be
// tested without a database — see test/library.document.test.ts. This is
// the file that has to be right: it is the only thing standing between a
// user's library and a lossy rewrite.
//
// THE INVARIANT: toDocument(toContents(x)) must preserve everything in x
// that the app or an importer put there. Book records have no fixed
// schema (exporter/ emits whatever columns the Kobo device had, Goodreads
// carries a different set, the app adds `_`-prefixed fields), so anything
// not lifted into a real column is round-tripped verbatim rather than
// dropped.

import type {
  Book,
  BookRecord,
  Group,
  GroupType,
  HighlightRecord,
  LibraryContents,
  LibrarySettings,
  Mural,
  MuralBlock
} from "./types.js";

/** Top-level document fields that are stored in real columns and so must
 *  NOT also be copied into the settings `extra` blob — otherwise they'd
 *  be written twice and could disagree on the way back out. */
const KNOWN_DOCUMENT_KEYS = new Set(["books", "groups", "murals", "name", "source", "schema_version", "style", "book_count"]);

// --- identity -------------------------------------------------------------

/** Mirrors frontend/src/lib/covers.ts's normalizeIsbn. Kept as its own
 *  function (rather than inlined into bookKey) so the two stay
 *  comparable line-for-line with their frontend originals. */
export function normalizeIsbn(raw: unknown): string {
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/[-\s]/g, "");
  return /^(?:\d{9}[\dXx]|\d{13})$/.test(cleaned) ? cleaned : "";
}

function normalizeForMatch(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** The app's cross-source identity for a book. MUST stay byte-identical
 *  to frontend/src/lib/merge.ts's bookKey(): groups and mural blocks
 *  reference books by this string, and a key computed differently on the
 *  two sides would silently orphan every one of those references.
 *
 *  ISBN first, since it's exact; falls back to normalized title+author
 *  for books without one on either side (common for indie/sideloaded
 *  titles) — imprecise, but the only signal available across sources
 *  that don't share a real ISBN. */
export function bookKey(book: BookRecord): string {
  const isbn = normalizeIsbn(book.ISBN);
  if (isbn) return `isbn:${isbn}`;
  const title = normalizeForMatch(book.Title);
  const author = normalizeForMatch(book.Attribution);
  return `ta:${title}|${author}`;
}

// --- narrowing helpers ----------------------------------------------------

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function nowIso(): string {
  return new Date().toISOString();
}

// --- document -> entities -------------------------------------------------

function toBook(raw: unknown): Book {
  const record = asRecord(raw);
  // `highlights` is split into its own table; everything else on the
  // record stays in `data`.
  const { highlights, ...rest } = record;

  const seenBookmarkIds = new Set<string>();
  const parsedHighlights: HighlightRecord[] = [];
  for (const entry of asArray(highlights)) {
    const highlight = asRecord(entry);
    // BookmarkID is the natural key (the schema has a UNIQUE on it, and
    // merge.ts's unionHighlights already dedupes on it). A highlight
    // without one, or a duplicate, would violate that constraint — so
    // synthesize a key rather than dropping the user's annotation.
    const rawId = highlight.BookmarkID;
    let id = typeof rawId === "string" && rawId !== "" ? rawId : `_synthetic:${parsedHighlights.length}`;
    while (seenBookmarkIds.has(id)) id = `${id}_dup${parsedHighlights.length}`;
    seenBookmarkIds.add(id);
    parsedHighlights.push({ ...highlight, BookmarkID: id });
  }

  const isbn = normalizeIsbn(record.ISBN);

  return {
    bookKey: bookKey(record),
    title: asString(record.Title),
    author: asString(record.Attribution),
    isbn: isbn === "" ? null : isbn,
    series: asString(record.Series),
    sortPosition: asNumber(record._order),
    data: rest,
    highlights: parsedHighlights
  };
}

function toGroup(raw: unknown, index: number): Group {
  const record = asRecord(raw);
  const now = nowIso();
  const type: GroupType = record.type === "series" ? "series" : "collection";
  return {
    id: asString(record.id) ?? `g_${index}_${now}`,
    type,
    name: typeof record.name === "string" ? record.name : "",
    style: record.style === undefined ? null : record.style,
    bookKeys: asArray(record.bookKeys).filter((k): k is string => typeof k === "string"),
    createdAt: asString(record.createdAt) ?? now,
    updatedAt: asString(record.updatedAt) ?? now
  };
}

function toMuralBlock(raw: unknown, index: number): MuralBlock {
  const record = asRecord(raw);
  const { id, type, layout, ...rest } = record;
  const parsedLayout = asRecord(layout);
  return {
    id: asString(id) ?? `b_${index}`,
    type: typeof type === "string" ? type : "empty",
    layout: {
      x: asNumber(parsedLayout.x) ?? 0,
      y: asNumber(parsedLayout.y) ?? 0,
      w: asNumber(parsedLayout.w) ?? 1,
      h: asNumber(parsedLayout.h) ?? 1
    },
    data: rest
  };
}

function toMural(raw: unknown, index: number): Mural {
  const record = asRecord(raw);
  const now = nowIso();
  return {
    id: asString(record.id) ?? `m_${index}_${now}`,
    name: typeof record.name === "string" ? record.name : "",
    blocks: asArray(record.blocks).map(toMuralBlock),
    coverImageId: asString(record.coverImageId),
    coverImageUrl: asString(record.coverImageUrl),
    createdAt: asString(record.createdAt) ?? now,
    updatedAt: asString(record.updatedAt) ?? now
  };
}

/** Decomposes an incoming library document into entities. `version` and
 *  `updatedAt` are the caller's to supply — this function is pure and
 *  has no clock of its own beyond defaulting absent entity timestamps. */
export function toContents(data: unknown, version: number, updatedAt: string): LibraryContents {
  const document = asRecord(data);

  // Any top-level field an importer set that we don't have a column for
  // rides along in the settings row, so a future importer field survives
  // a round trip without a schema change.
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(document)) {
    if (!KNOWN_DOCUMENT_KEYS.has(key)) extra[key] = value;
  }

  const settings: LibrarySettings = {
    name: asString(document.name),
    source: asString(document.source),
    schemaVersion: asNumber(document.schema_version),
    style: document.style === undefined ? null : document.style,
    extra,
    version,
    updatedAt
  };

  return {
    settings,
    // Deliberately NOT de-duplicated by bookKey here. mergeBookLists()
    // on the frontend already owns that decision and explicitly leaves
    // duplicates within a single import alone; silently collapsing them
    // at the storage layer would be a behaviour change. The repository
    // handles the collision instead (last one wins), matching what a
    // Map-keyed rebuild of the same list would do.
    books: asArray(document.books).map(toBook),
    groups: asArray(document.groups).map(toGroup),
    murals: asArray(document.murals).map(toMural)
  };
}

/** Single-entity entry points, for the per-entity write path in
 *  service.ts. The same functions the whole-document path uses, so a book
 *  saved on its own and a book saved as part of a document decompose
 *  identically — including how its key is derived. */
export function toBookEntity(raw: unknown): Book {
  return toBook(raw);
}

export function toGroupEntity(raw: unknown): Group {
  // Index 0 is only a fallback for a group arriving without an id, which
  // the routes reject before this is reached.
  return toGroup(raw, 0);
}

export function toMuralEntity(raw: unknown): Mural {
  return toMural(raw, 0);
}

// --- entities -> document -------------------------------------------------

function fromBook(book: Book): BookRecord {
  const record: BookRecord = { ...book.data };
  // Only re-attach `highlights` if the book actually has any, so a book
  // that arrived without the field doesn't gain an empty array it never
  // had.
  if (book.highlights.length > 0) record.highlights = book.highlights;
  return record;
}

function fromGroup(group: Group): Record<string, unknown> {
  const record: Record<string, unknown> = {
    id: group.id,
    type: group.type,
    name: group.name,
    bookKeys: group.bookKeys,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt
  };
  if (group.style !== null) record.style = group.style;
  return record;
}

function fromMuralBlock(block: MuralBlock): Record<string, unknown> {
  return { id: block.id, type: block.type, layout: block.layout, ...block.data };
}

function fromMural(mural: Mural): Record<string, unknown> {
  const record: Record<string, unknown> = {
    id: mural.id,
    name: mural.name,
    blocks: mural.blocks.map(fromMuralBlock),
    createdAt: mural.createdAt,
    updatedAt: mural.updatedAt
  };
  // Both present or absent together — never one without the other (see
  // frontend/src/lib/murals.ts's Mural).
  if (mural.coverImageId !== null && mural.coverImageUrl !== null) {
    record.coverImageId = mural.coverImageId;
    record.coverImageUrl = mural.coverImageUrl;
  }
  return record;
}

/** Reassembles the document the frontend expects. Optional collections
 *  (`groups`, `murals`, `style`, `name`) are omitted when empty rather
 *  than emitted as `[]`/`null`, matching how the frontend's own
 *  LibraryData treats them — absent until first used. */
export function toDocument(contents: LibraryContents): Record<string, unknown> {
  const { settings, books, groups, murals } = contents;

  const document: Record<string, unknown> = { ...settings.extra };

  if (settings.source !== null) document.source = settings.source;
  if (settings.schemaVersion !== null) document.schema_version = settings.schemaVersion;
  if (settings.name !== null) document.name = settings.name;
  if (settings.style !== null) document.style = settings.style;

  document.books = books.map(fromBook);
  document.book_count = books.length;

  if (groups.length > 0) document.groups = groups.map(fromGroup);
  if (murals.length > 0) document.murals = murals.map(fromMural);

  return document;
}
