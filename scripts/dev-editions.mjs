#!/usr/bin/env node
// Catalog works with several editions, so the work page's edition strip has
// something to show. The fixture library is one book per work, which leaves
// the strip hidden everywhere.
//
// Editions of one work share an Open Library work key, the same grouping the
// catalog seeder uses, so no network is needed. The Hobbit is the dev
// account's own book and its owned edition (9780547928227) is created last,
// so "Back to your edition" has somewhere to go back from. Dune has three
// editions and nobody owns it: it is reached through search.
//
// Runs right after dev-account.mjs and before anything boots the backend (see
// devFixtureSetup.mjs), against whatever backend/data/dev/ the *_DB_PATH vars point at. Idempotent:
// an edition that already has its cover and details is left alone.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { ensureBackendEnv } from "./dev-account.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const WORKS = [
  {
    workKey: "OL262758W",
    author: "J.R.R. Tolkien",
    genres: ["Fantasy", "Classics", "Children's"],
    series: { name: "Middle-earth", position: null },
    editions: [
      { isbn: "9780261102217", title: "The Hobbit", languages: ["eng"], year: 1999, pages: 310, publisher: "HarperCollins", color: "#8a5a2b", summary: "Bilbo Baggins likes his armchair and his pantry. A wizard and thirteen dwarves talk him into a long walk east, with a dragon at the end of it and a ring he picks up on the way." },
      { isbn: "9788445077528", title: "El hobbit", languages: ["spa"], year: 2012, pages: 320, publisher: "Minotauro", color: "#b3361f", summary: "A Bilbo Bolsón le gustan su sillón y su despensa. Un mago y trece enanos lo convencen de emprender un largo viaje hacia el este, con un dragón al final del camino." },
      { isbn: "9788595084742", title: "O Hobbit", languages: ["por"], year: 2019, pages: 336, publisher: "HarperCollins Brasil", color: "#1f6f8b", summary: "Bilbo Bolseiro gosta da sua poltrona e da sua despensa. Um feiticeiro e treze anões convencem-no a partir numa longa viagem para leste, com um dragão no fim do caminho." },
      { isbn: "9780547928227", title: "The Hobbit", languages: ["eng"], year: 2012, pages: 300, publisher: "Mariner Books", color: "#3b7d3a", summary: "Bilbo Baggins likes his armchair and his pantry. A wizard and thirteen dwarves talk him into a long walk east, with a dragon at the end of it and a ring he picks up on the way." },
    ],
  },
  {
    workKey: "OL893415W",
    author: "Frank Herbert",
    genres: ["Science Fiction", "Classics"],
    series: { name: "Dune Chronicles", position: "1" },
    editions: [
      { isbn: "9780441172719", title: "Dune", languages: ["eng"], year: 2005, pages: 535, publisher: "Ace", color: "#c98a2b", summary: "On the desert planet that is the only source of the spice, a young duke's son survives his family's betrayal and finds a place among the people of the sand." },
      { isbn: "9788576573135", title: "Duna", languages: ["por"], year: 2017, pages: 680, publisher: "Aleph", collection: { name: "Clássicos Aleph", position: "12" }, color: "#7a3b8c", summary: "No planeta deserto que é a única fonte da especiaria, o filho de um duque sobrevive à traição contra a sua família e encontra lugar entre o povo das areias." },
      { isbn: "9788497595063", title: "Dune", languages: ["spa"], year: 2011, pages: 592, publisher: "Debolsillo", color: "#2c4f9e", summary: "En el planeta desierto que es la única fuente de la especia, el hijo de un duque sobrevive a la traición contra su familia y encuentra un lugar entre el pueblo de la arena." },
    ],
  },
];

ensureBackendEnv();
process.chdir(join(repoRoot, "backend"));

const { openBooksDb } = await import("../backend/src/modules/books/adapters/sqlite/connection.ts");
const { createSqliteBooksRepository } = await import("../backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts");
const { seedBook } = await import("../backend/src/modules/books/seed/seedCatalog.ts");
const { storeCoverImage } = await import("../backend/src/modules/books/booksService.ts");
const { encodeCover } = await import("../backend/src/modules/books/domain/images.ts");
const { createObjectStore } = await import("../backend/src/storage/createObjectStore.ts");

const escapeXml = (text) => text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);

function coverSvg(title, color) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="${color}"/><rect x="40" y="40" width="520" height="820" fill="none" stroke="#fff" stroke-width="6"/><text x="300" y="450" font-size="64" fill="#fff" text-anchor="middle" font-family="sans-serif">${escapeXml(title)}</text></svg>`,
  );
}

const db = openBooksDb();
const repo = createSqliteBooksRepository(db);
const blobs = { save: (id, extension, bytes) => createObjectStore().put(`covers/${id}.${extension}`, bytes, "image/webp") };

const at = new Date().toISOString();

try {
  for (const work of WORKS) {
    for (const edition of work.editions) {
      const { outcome, book } = seedBook({ isbn: edition.isbn, title: edition.title, author: work.author, workKey: work.workKey, languages: edition.languages }, repo, () => new Date(), "seed");
      if (!book) throw new Error(`Could not seed ${edition.title} (${edition.isbn}).`);
      repo.mergeDetails(book.id, { summary: edition.summary, pages: edition.pages, year: edition.year, publisher: edition.publisher, translator: null }, null);
      if (!book.cover_image_id) {
        const image = await encodeCover(await sharp(coverSvg(edition.title, edition.color)).png().toBuffer());
        const imageId = await storeCoverImage({ repo, blobs }, book.id, "upload", null, image, at);
        repo.setCover(book.id, { imageId, status: "manual", checkedAt: at });
      }
      if (edition.collection) repo.addBookCollection(book.id, edition.collection, "bnp", at);
      console.log(`[dev-editions] ${outcome} ${work.workKey} ${edition.languages[0]} ${edition.isbn} ${edition.title}`);
    }
    const workId = repo.findBookByKey(`isbn:${work.editions[0].isbn}`)?.work_id;
    if (!workId) throw new Error(`No work for ${work.editions[0].title} (${work.editions[0].isbn}).`);
    repo.fillSourceGenres(workId, work.genres);
    repo.addWorkSeries(workId, [work.series], "wikidata", at);
  }
} finally {
  db.close();
}
