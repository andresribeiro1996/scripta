import assert from "node:assert/strict";
import { test } from "node:test";
import { findBestCover, type CoverSources, type FetchCoverImage } from "./coverResolver.js";
import { SourceUnavailableError } from "./domain/errors.js";
import type { CoverCandidate, CoverSource, TitledCandidate } from "./domain/ports.js";

const orlando = { isbn: "9780141184272", title: "Orlando (Penguin Modern Classics)", author: "Virginia Woolf" };

function source(options: { isbn?: CoverCandidate[] | Error; titled?: TitledCandidate[] | Error } = {}): CoverSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async byIsbn(isbn) {
      calls.push(`isbn:${isbn}`);
      if (options.isbn instanceof Error) throw options.isbn;
      return options.isbn ?? [];
    },
    async byTitle(title, _author, accept) {
      calls.push(`title:${title}`);
      if (options.titled instanceof Error) throw options.titled;
      return (options.titled ?? []).filter(accept).map(({ source, url }) => ({ source, url }));
    }
  };
}

function images(sizes: Record<string, [number, number]>): FetchCoverImage {
  return async (candidate) => {
    const size = sizes[candidate.url];
    return size ? { full: Buffer.alloc(8), thumb: Buffer.alloc(4), width: size[0], height: size[1] } : null;
  };
}

function sources(partial: Partial<CoverSources>): CoverSources {
  return { isbndb: null, apple: source(), openlibrary: source(), ...partial };
}

test("Apple is asked before ISBNdb for an exact edition and a good cover ends the chain", async () => {
  const isbndb = source({ isbn: [{ source: "isbndb", url: "https://i/1" }] });
  const apple = source({ isbn: [{ source: "apple", url: "https://a/1" }] });
  const outcome = await findBestCover(orlando, new Set(), sources({ isbndb, apple }), images({ "https://i/1": [900, 1400], "https://a/1": [900, 1400] }));
  assert.equal(outcome.found?.candidate.url, "https://a/1");
  assert.equal(outcome.complete, true);
  assert.deepEqual(apple.calls, ["isbn:9780141184272"]);
  assert.deepEqual(isbndb.calls, []);
});

test("ISBNdb fills the gap when Apple has no cover for the edition", async () => {
  const isbndb = source({ isbn: [{ source: "isbndb", url: "https://i/1" }] });
  const outcome = await findBestCover(orlando, new Set(), sources({ isbndb }), images({ "https://i/1": [900, 1400] }));
  assert.equal(outcome.found?.candidate.url, "https://i/1");
  assert.deepEqual(isbndb.calls, ["isbn:9780141184272"]);
});

test("a later good cover beats earlier small ones", async () => {
  const outcome = await findBestCover(orlando, new Set(), sources({
    openlibrary: source({ isbn: [{ source: "openlibrary", url: "https://o/1" }] }),
    apple: source({ titled: [{ source: "apple", url: "https://a/2", title: "Orlando", authors: ["Virginia Woolf"] }] })
  }), images({ "https://o/1": [300, 460], "https://a/2": [900, 1400] }));
  assert.equal(outcome.found?.candidate.url, "https://a/2");
});

test("when nothing reaches 400px the largest acceptable image is kept", async () => {
  const outcome = await findBestCover(orlando, new Set(), sources({
    isbndb: source({ isbn: [{ source: "isbndb", url: "https://i/1" }] }),
    openlibrary: source({ isbn: [{ source: "openlibrary", url: "https://o/1" }] })
  }), images({ "https://i/1": [250, 390], "https://o/1": [320, 480] }));
  assert.equal(outcome.found?.candidate.url, "https://o/1");
  assert.equal(outcome.complete, true);
});

test("rejected URLs, non-portrait images and the ISBNdb placeholder are skipped", async () => {
  const outcome = await findBestCover(orlando, new Set(["https://i/rejected"]), sources({
    isbndb: source({ isbn: [{ source: "isbndb", url: "https://i/rejected" }, { source: "isbndb", url: "https://i/placeholder" }, { source: "isbndb", url: "https://i/landscape" }] }),
    openlibrary: source({ isbn: [{ source: "openlibrary", url: "https://o/1" }] })
  }), images({ "https://i/rejected": [900, 1400], "https://i/placeholder": [200, 248], "https://i/landscape": [1030, 773], "https://o/1": [320, 480] }));
  assert.equal(outcome.found?.candidate.url, "https://o/1");
});

test("title candidates must match title and any listed author", async () => {
  const book = { isbn: null, title: "A Quinta dos Animais", author: "Paulo Faria, George Orwell" };
  const outcome = await findBestCover(book, new Set(), sources({
    apple: source({ titled: [
      { source: "apple", url: "https://a/near", title: "A Quinta dos Animais e Outros", authors: ["George Orwell"] },
      { source: "apple", url: "https://a/right", title: "A Quinta dos Animais", authors: ["George Orwell"] }
    ] })
  }), images({ "https://a/near": [900, 1400], "https://a/right": [900, 1400] }));
  assert.equal(outcome.found?.candidate.url, "https://a/right");
});

test("an unavailable source marks the outcome incomplete, records the failure and the chain continues", async () => {
  const isbndbFailure = new SourceUnavailableError("isbndb", "HTTP 429");
  const outcome = await findBestCover(orlando, new Set(), sources({
    isbndb: source({ isbn: isbndbFailure }),
    openlibrary: source({ isbn: [{ source: "openlibrary", url: "https://o/1" }] })
  }), images({ "https://o/1": [320, 480] }));
  assert.equal(outcome.found?.candidate.url, "https://o/1");
  assert.equal(outcome.complete, false);
  assert.deepEqual(outcome.failures, [isbndbFailure]);
});

test("an image download that is unavailable also marks the outcome incomplete and is recorded", async () => {
  const downloadFailure = new SourceUnavailableError("apple", "HTTP 503");
  const fetchImage: FetchCoverImage = async () => {
    throw downloadFailure;
  };
  const outcome = await findBestCover(orlando, new Set(), sources({ apple: source({ isbn: [{ source: "apple", url: "https://a/1" }] }) }), fetchImage);
  assert.deepEqual(outcome, { found: null, complete: false, failures: [downloadFailure] });
});

test("unexpected errors propagate", async () => {
  await assert.rejects(findBestCover(orlando, new Set(), sources({ apple: source({ isbn: new Error("bug") }) }), images({})), /bug/);
});

test("without an ISBN only title steps run; an empty title runs nothing", async () => {
  const apple = source();
  await findBestCover({ isbn: null, title: "Solaris", author: "Stanisław Lem" }, new Set(), sources({ apple }), images({}));
  assert.deepEqual(apple.calls, ["title:Solaris"]);
  const idle = source();
  assert.deepEqual(await findBestCover({ isbn: null, title: "?!", author: "" }, new Set(), sources({ apple: idle }), images({})), { found: null, complete: true, failures: [] });
  assert.deepEqual(idle.calls, []);
});
