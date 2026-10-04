import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { sample: { type: "string", default: "0" } } });
const sampleSize = Number(values.sample);
if (!Number.isInteger(sampleSize) || sampleSize < 0) {
  console.error(`--sample must be a non-negative integer, got "${values.sample}"`);
  process.exit(1);
}
for (const name of ["COVERS_DB_PATH", "LIBRARY_DB_PATH"]) {
  if (!process.env[name]) {
    console.error(`Missing environment variable: ${name}`);
    process.exit(1);
  }
}

const { catalogTitleKey, lookupIdentity } = await import("../dist/modules/books/domain/normalize.js");
const { matchFacts } = await import("@scripta/shared");

const covers = new DatabaseSync(process.env.COVERS_DB_PATH, { readOnly: true });
const library = new DatabaseSync(process.env.LIBRARY_DB_PATH, { readOnly: true });

const region = (isbn) => {
  if (!isbn) return "none";
  if (/^(978972|978989|972|989)/.test(isbn)) return "pt-PT";
  if (/^(97885|97865)/.test(isbn) || (isbn.length === 10 && /^(85|65)/.test(isbn))) return "pt-BR";
  return "other";
};
const bump = (counts, key, by = 1) => { counts[key] = (counts[key] ?? 0) + by; };

const works = new Map(covers.prepare("SELECT id, ol_work_key AS key, merged_into AS mergedInto FROM works").all().map((w) => [w.id, w]));
const resolveWork = (id) => {
  let work = works.get(id);
  for (let hops = 0; work?.mergedInto && hops < 10; hops++) work = works.get(work.mergedInto);
  return work;
};

const books = covers.prepare(
  "SELECT id, title, author, isbn, ol_work_key AS key, work_id AS workId, created_by AS createdBy, details_status AS details FROM books"
).all();
const bookById = new Map();
const byGroup = new Map();
const byLoose = new Map();
const addTo = (map, key, book) => {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(book);
};
for (const book of books) {
  book.work = book.workId ? resolveWork(book.workId) : undefined;
  book.group = catalogTitleKey(book.title, book.author);
  const facts = matchFacts({ Title: book.title, Attribution: book.author });
  book.loose = facts.loose ? `${facts.loose}|${facts.numbers}` : null;
  bookById.set(book.id, book);
  addTo(byGroup, book.group, book);
  addTo(byLoose, book.loose, book);
}

const peerFacts = (map, key, book) => {
  const peers = key ? map.get(key).filter((peer) => peer.id !== book.id) : [];
  const keyedWorks = new Set(peers.filter((peer) => peer.work?.key).map((peer) => peer.work.key));
  return { keyedWorks: keyedWorks.size, keylessPeers: peers.filter((peer) => !peer.work?.key).length };
};
const bucket = ({ keyedWorks, keylessPeers }) =>
  keyedWorks > 1 ? "ambiguous: >1 keyed work" : keyedWorks === 1 ? "one keyed work" : keylessPeers > 0 ? "keyless peers only" : "alone";
const groupBucket = (book) => {
  const strict = bucket(peerFacts(byGroup, book.group, book));
  return strict === "alone" ? `loose only: ${bucket(peerFacts(byLoose, book.loose, book))}` : `title key: ${strict}`;
};

const catalog = { editions: books.length, keyed: 0, keyless: 0, noWork: 0, keylessBy: { createdBy: {}, isbn: {}, details: {}, emptyTitle: 0, titleGroup: {} } };
const keylessEditions = [];
for (const book of books) {
  if (!book.work) { catalog.noWork++; continue; }
  if (book.work.key) { catalog.keyed++; continue; }
  catalog.keyless++;
  keylessEditions.push(book);
  bump(catalog.keylessBy.createdBy, book.createdBy ?? "user lookup");
  bump(catalog.keylessBy.isbn, region(book.isbn));
  if (book.isbn) bump(catalog.keylessBy.details, book.details === null ? "not checked yet" : `checked: ${book.details}`);
  if (!book.title) catalog.keylessBy.emptyTitle++;
  bump(catalog.keylessBy.titleGroup, groupBucket(book));
}

const workCounts = covers.prepare(
  `SELECT COUNT(*) AS total,
          SUM(ol_work_key IS NOT NULL) AS keyed,
          SUM(ol_work_key IS NULL AND merged_into IS NULL) AS keylessLive,
          SUM(merged_into IS NOT NULL) AS merged,
          SUM(merged_into IS NULL AND NOT EXISTS (SELECT 1 FROM books WHERE work_id = works.id)) AS emptyLive
   FROM works`
).get();

const after = covers.prepare(
  `SELECT
     SUM(books.ol_work_key IS NULL AND works.ol_work_key IS NOT NULL) AS keylessEditionsInKeyedWorks,
     SUM(books.title_group_blocked_at IS NOT NULL) AS blockedEditions,
     SUM(books.work_checked_at IS NOT NULL) AS lookedUp,
     SUM(books.work_checked_at IS NOT NULL AND books.ol_work_key IS NOT NULL) AS lookedUpAndKeyed,
     SUM(books.title_key IS NULL AND books.title <> '') AS titleKeysPending,
     (SELECT COUNT(*) FROM works AS w WHERE w.merged_into IN (SELECT id FROM works WHERE merged_into IS NOT NULL)) AS chainsLongerThanOneHop,
     (SELECT COUNT(*) FROM works AS w WHERE w.ol_work_key IS NULL AND w.merged_into IS NULL AND (SELECT COUNT(*) FROM books AS b WHERE b.work_id = w.id) > 1) AS keylessGroups
   FROM books JOIN works ON works.id = books.work_id`
).get();

const keySpread = (map) => {
  const spread = { groupsWithAKeyedEdition: 0, groupsSpanningSeveralKeyedWorks: 0 };
  for (const group of map.values()) {
    const keys = new Set(group.filter((book) => book.work?.key).map((book) => book.work.key));
    if (keys.size > 0) spread.groupsWithAKeyedEdition++;
    if (keys.size > 1) spread.groupsSpanningSeveralKeyedWorks++;
  }
  return spread;
};

const byKey = covers.prepare("SELECT book_id AS id FROM book_keys WHERE key = ?");
const findBook = (key) => (key ? byKey.get(key)?.id : undefined);
const rows = library.prepare("SELECT user_id AS userId, title, author, isbn FROM library_books").all();
const lib = {
  users: library.prepare("SELECT COUNT(*) AS n FROM library_documents").get().n,
  usersWithRows: new Set(rows.map((row) => row.userId)).size,
  rows: rows.length,
  unresolved: 0,
  resolvedBy: {},
  toKeyless: 0
};
const readersByEdition = new Map();
for (const row of rows) {
  const identity = lookupIdentity({ isbn: row.isbn ?? "", title: row.title ?? "", author: row.author ?? "" });
  const viaKey = identity && findBook(identity.key);
  const viaTitle = !viaKey && identity && identity.titleKey !== identity.key ? findBook(identity.titleKey) : undefined;
  const bookId = viaKey ?? viaTitle;
  if (!bookId) { lib.unresolved++; continue; }
  bump(lib.resolvedBy, viaKey ? identity.key.slice(0, identity.key.indexOf(":")) : "ta (fallback)");
  if (!bookById.get(bookId)?.work?.key) lib.toKeyless++;
  if (!readersByEdition.has(bookId)) readersByEdition.set(bookId, new Set());
  readersByEdition.get(bookId).add(row.userId);
}

const referenced = { editions: 0, keyed: 0, keyless: 0, keylessReaders: new Set(), keylessBy: { createdBy: {}, isbn: {}, details: {}, titleGroup: {} }, keylessWithTwoReaders: 0 };
for (const [bookId, readers] of readersByEdition) {
  const book = bookById.get(bookId);
  referenced.editions++;
  if (book.work?.key) { referenced.keyed++; continue; }
  referenced.keyless++;
  for (const reader of readers) referenced.keylessReaders.add(reader);
  if (readers.size > 1) referenced.keylessWithTwoReaders++;
  bump(referenced.keylessBy.createdBy, book.createdBy ?? "user lookup");
  bump(referenced.keylessBy.isbn, region(book.isbn));
  if (book.isbn) bump(referenced.keylessBy.details, book.details === null ? "not checked yet" : `checked: ${book.details}`);
  bump(referenced.keylessBy.titleGroup, groupBucket(book));
}
referenced.keylessReaders = referenced.keylessReaders.size;

const splits = { titleGroups: 0, readers: new Set() };
const workId = (book) => book.work?.key ?? book.work?.id ?? book.id;
const referencedByGroup = new Map();
for (const [bookId, readers] of readersByEdition) {
  const book = bookById.get(bookId);
  if (!book.group) continue;
  if (!referencedByGroup.has(book.group)) referencedByGroup.set(book.group, []);
  referencedByGroup.get(book.group).push({ work: workId(book), readers });
}
for (const entries of referencedByGroup.values()) {
  const distinctWorks = new Set(entries.map((entry) => entry.work));
  const readers = new Set(entries.flatMap((entry) => [...entry.readers]));
  if (distinctWorks.size > 1 && readers.size > 1) {
    splits.titleGroups++;
    for (const reader of readers) splits.readers.add(reader);
  }
}
splits.readers = splits.readers.size;

const report = {
  catalog,
  works: workCounts,
  grouping: after,
  groupingAsWorkKey: { titleKey: keySpread(byGroup), loose: keySpread(byLoose) },
  library: lib,
  referenced,
  splitStats: splits
};
if (sampleSize > 0) {
  report.sampleIsbns = keylessEditions
    .filter((book) => book.isbn && book.details !== null)
    .sort(() => Math.random() - 0.5)
    .slice(0, sampleSize)
    .map((book) => ({ isbn: book.isbn, createdBy: book.createdBy ?? "user lookup", region: region(book.isbn) }));
}
console.log(JSON.stringify(report, null, 2));
covers.close();
library.close();
