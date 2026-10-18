import { storeCoverImage } from "../booksService.js";
import { MIN_GOOD_WIDTH } from "../domain/constants.js";
import { SourceUnavailableError } from "../domain/errors.js";
import { fillMissingIdentity, keysOf } from "../domain/findOrCreate.js";
import { encodeCover, isAcceptableCover, type EncodedCover } from "../domain/images.js";
import { editionLanguage, isPortugueseIsbn, lookupIdentity } from "../domain/normalize.js";
import type { BooksRepository, CoverBlobStore } from "../domain/ports.js";
import type { BookRow, CoverImageRow } from "../domain/types.js";
import type { BnpBook } from "./bnpRecord.js";
import { udcGenres } from "./bnpScope.js";
import { fetchBytes } from "./siteFetch.js";

export interface BnpDeps {
  repo: BooksRepository;
  blobs: CoverBlobStore;
  fetchScan: (url: string) => Promise<EncodedCover | null>;
  now: () => Date;
}

export type BnpReplace = "new" | "none" | "lowRes" | "isbndb";
export type BnpCoverAction = "stored" | "kept" | "noScan" | "rejected" | "failed";

export interface BnpPlan {
  book: BnpBook;
  isbn: string;
  existing: BookRow | undefined;
  replace: BnpReplace | null;
}

export function bnpReplaceReason(existing: BookRow | undefined, image: CoverImageRow | undefined): BnpReplace | null {
  if (!existing) return "new";
  if (existing.cover_status === "manual") return null;
  if (!existing.cover_image_id) return "none";
  if (existing.cover_status === "low_res") return "lowRes";
  if (image?.source === "isbndb" && isPortugueseIsbn(existing.isbn)) return "isbndb";
  return null;
}

type ReplaceRepo = Pick<BooksRepository, "getImage">;

function replaceReasonOf(repo: ReplaceRepo, row: BookRow | undefined): BnpReplace | null {
  return bnpReplaceReason(row, row?.cover_image_id ? repo.getImage(row.cover_image_id) : undefined);
}

export function planBnpRecord(repo: Pick<BooksRepository, "findBookByKey" | "getImage">, book: BnpBook, isbn: string | undefined = book.isbns[0]): BnpPlan | null {
  if (isbn === undefined) return null;
  const existing = repo.findBookByKey(`isbn:${isbn}`);
  return { book, isbn, existing, replace: replaceReasonOf(repo, existing) };
}

export async function applyBnpRecord(deps: BnpDeps, plan: BnpPlan): Promise<{ book: BookRow; created: boolean; cover: BnpCoverAction }> {
  const { book, isbn } = plan;
  const identity = lookupIdentity({ isbn, title: book.title, author: book.author });
  if (!identity?.isbn) throw new Error(`Not a valid ISBN: ${isbn}`);
  const at = deps.now().toISOString();

  let scan: { url: string; image: EncodedCover } | null = null;
  let cover: BnpCoverAction = book.scanUrl === null ? "noScan" : "kept";
  if (plan.replace !== null && book.scanUrl !== null) {
    let image: EncodedCover | null = null;
    try {
      image = await deps.fetchScan(book.scanUrl);
    } catch (error) {
      if (!(error instanceof SourceUnavailableError)) throw error;
    }
    if (image === null) cover = "failed";
    else if (!isAcceptableCover("bnp", image.width, image.height)) cover = "rejected";
    else scan = { url: book.scanUrl, image };
  }

  const written = deps.repo.transaction(() => {
    const held = deps.repo.findBookByKey(`isbn:${isbn}`);
    const row = held ?? deps.repo.createBook({ title: identity.title, author: identity.author, isbn: identity.isbn, year: book.year, publisher: book.publisher, genres: udcGenres(book.udc), createdBy: "bnp" }, keysOf(deps.repo, identity), at);
    if (held) {
      fillMissingIdentity(deps.repo, held, identity.title, identity.author);
      deps.repo.fillSubjectGenres(held.id, udcGenres(book.udc));
      deps.repo.confirmWithSource(held.id, "bnp");
    } else {
      deps.repo.setCover(row.id, { imageId: null, status: null, checkedAt: at });
    }
    deps.repo.mergeDetails(row.id, { summary: book.summary, pages: book.pages, year: book.year, publisher: book.publisher, translator: book.translator }, "bnp");
    if (book.originalTitle) deps.repo.fillOriginalTitle(row.id, book.originalTitle);
    deps.repo.setLanguage(row.id, editionLanguage(book.languages, isbn));
    return { id: row.id, created: held === undefined, replaceable: replaceReasonOf(deps.repo, row) !== null, expected: row.cover_image_id };
  });

  if (scan !== null) {
    if (written.replaceable) {
      const imageId = await storeCoverImage(deps, written.id, "bnp", scan.url, scan.image, at);
      const stored = deps.repo.setCoverIf(written.id, written.expected, { imageId, status: scan.image.width >= MIN_GOOD_WIDTH ? "good" : "low_res", checkedAt: at });
      cover = stored ? "stored" : "kept";
    } else {
      cover = "kept";
    }
  }
  return { book: deps.repo.getBook(written.id)!, created: written.created, cover };
}

export async function fetchBnpScan(url: string): Promise<EncodedCover | null> {
  const bytes = await fetchBytes(url);
  return bytes === null ? null : encodeCover(bytes);
}
