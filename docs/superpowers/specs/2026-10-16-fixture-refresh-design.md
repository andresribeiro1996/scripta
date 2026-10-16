# Fixture refresh

## Problem

A 2026-10-16 audit of the fixtures found that their format still matches the code, but they have fallen behind what the app shows and parses.

- **The dev account is thin.** The 24 books carry only title, author, ISBN, series and read status. They have no ratings, read dates, genres or typed highlights. So book stats tiles, Favourites, "Reader since", the shelf preset's reader card and quote blocks, Home's highlights card, quizzes, and the synopsis and genre chips on a work page all show nothing, or need the network or hand-written SQL. The device-checker is not allowed to write fixtures, so a data gap blocks a device pass.
- **Two fixture ISBNs are invalid.** The Two Towers (`9780544003423`) and The Return of the King (`9780544003430`) have wrong check digits.
- **Quizzes escape the dev data directory.** `DB_MODULES` in `scripts/devDataDir.mjs` omits `quizzes`, and so does the copy of that list in `backend/scripts/three-users.mjs`. Dev runs and `npm run test:fixture` therefore open the developer's own `backend/data/quizzes.sqlite`.
- **The newest parsing paths have no recorded fixture.** Authors from the four shops' product-page links, Presença's author tags, and the feed-ISBN-then-page-author path (`6b0ba0f0`) are tested only against hand-written snippets.
- **The Codex review never knows its model.** `codexUsage` reads a `model` field that `codex exec --json` never emits. Every report says "Model: unknown" and every `rounds.jsonl` line has `model: null`.
- **`npm run test:fixture` is not in CI.** It covers privacy, ownership and ballots for the three fixture users.

## Decisions

- **Synthetic data, no network.** Ratings, read dates, genres, passages, quizzes, edition synopses and catalog genres are written by the seeds. Covers stay network-resolved, as today.
- **The dev account becomes a settled reader.** With genres on every book it settles as the Corridor reader (`corr`) with a fantasy and science-fiction streak (`star`). The pinned test in `readerIdentity.test.ts` moves with it.
  - Online genre lookups already made the old "leaning" state non-deterministic on a device.
  - The leaning state stays covered by its unit tests.
- **Recorded shop responses are committed as test fixtures.** They were recorded on 2026-10-16 and trimmed because the repo is public:
  - Pages keep only the product section and the first related-product card, without scripts, styles or SVG.
  - In pages, these are replaced by `Texto omitido.`:
    - any quoted text;
    - any text run of 40 characters or more, unless it is a metadata line of 80 characters or less;
    - any `content`, `title`, `alt` or `aria-label` value of 40 characters or more.
  - Feed descriptions become `Sinopse omitida.` plus only the lines that start with a metadata label (ISBN, pages, original title, author, translation, year, edition).
  - No text run in the committed fixtures is longer than 46 characters, and that one is a product title.
- **The fixture users' content goes where it is tested.**
  - Ratings, typed highlights and alice's quiz go in `three-users.mjs`, which `--check` exercises in CI.
  - The dev account's quiz, and alice's play of it, go in `dev-community.mjs`, the only seed that has both accounts.
- **The Codex model is read from Codex's own config.** That is `$CODEX_HOME/config.toml`, defaulting to `~/.codex/config.toml`, used when the event stream has no model.

## Scope

1. Every backend database the dev workflow opens lives in the dev data directory. `three-users.mjs` reuses `devDataDirEnv` instead of its own copy of the list.
2. `scripts/fixtures/library.json`:
   - valid ISBNs for The Two Towers (`9780547928203`) and The Return of the King (`9780547928197`), with the LOTR series group and `dev-community.mjs` following;
   - The Return of the King becomes finished;
   - every finished book gets a `Rating` and a `DateLastRead`;
   - every book gets `_genres`;
   - four typed highlights on three public-domain books.
3. `three-users.mjs`: finished books carry `Rating: 4`, highlights carry `Type: "highlight"`, and alice publishes a four-question blurb quiz. `--check` asserts the quiz board.
4. `dev-community.mjs`: the dev account publishes a four-question blurb quiz and alice plays it. Both steps are idempotent.
5. `dev-editions.mjs`: every edition gets a synopsis in its own language, and both works get catalog genres. Both are idempotent.
6. Recorded fixtures and the tests that read them:
   - a Presença feed page and a Relógio feed page;
   - product pages from Relógio d'Água, Gradiva, Guerra & Paz and Penguin Livros;
   - one importer test that runs the Relógio feed and page end to end.
7. CI runs `npm run test:fixture --workspace backend`. The emulator docs describe what the fixture holds and when `--reset` is needed.
8. The Codex review reports the configured model.

## Non-goals

- Offline covers.
- "Possibly X" genre chips. They need Jev judgment rows.
- Genre chips on owned books other than The Hobbit. A work page takes genres from the catalog, which Open Library details fill when online.
- An automated test of `dev-account.mjs`, `dev-editions.mjs` and `dev-community.mjs` against a fresh directory.
  - They throw on any non-2xx at the next emulator boot.
  - A test would need a data-directory override, and it would write `mobile/.env.local`.
- Migrating existing data directories.
  - Changes to `library.json` and `three-users.mjs` need `--reset`.
  - Changes to `dev-community.mjs` and `dev-editions.mjs` reach existing directories on the next boot.
- Recording ISBNdb (needs the user's key), Open Library or Kobo responses.

## Acceptance

- These pass:
  - `npm test --workspace @scripta/shared`
  - `npm test --workspace backend`
  - `npm run test:scripts`
  - `npm run test:fixture --workspace backend`, run with a clean environment
- After a reset seed of the dev data directory:
  - the dev account's dashboard has a quiz publication from fixture_alice and a quiz participation row;
  - The Hobbit's work page has a synopsis and genres;
  - Dune's work page has a synopsis and genres.
- On the emulator, if it is free:
  - the shelf preset offers the reader card, a passage and Favourites;
  - The Return of the King's book screen shows a community rating from 3 readers.
