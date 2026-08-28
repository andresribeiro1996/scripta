# Kobo Library Viewer

> **Superseded by [../frontend](../frontend/README.md)**, which does everything this does plus accounts (multiple libraries, not just the one loaded in your browser right now) and installs as a PWA. This viewer still works standalone (no backend, no account, nothing to set up) — kept around for that reason — but isn't where new features land.

A single static page that renders a Kobo library — books, reading progress, highlights and notes — as a searchable, filterable card grid. No backend, no build step, no dependencies beyond the vendored SQLite engine described below.

## Usage

Open `index.html` in a browser (double-click it, or host the `viewer/` folder anywhere). Then drop one of these onto it, or use "Choose file…":

- **`library.json`** — output of the [exporter CLI](../exporter/export.py),
- **`KoboReader.sqlite`** — the Kobo device's own database (found at `.kobo/KoboReader.sqlite` on its USB drive). The viewer detects this by its file header (not by filename), converts it to the same JSON shape entirely in the browser, and renders it immediately — no need to run the Python exporter first, or
- **A Goodreads library export `.csv`** — from goodreads.com: **My Books → Tools (left sidebar) → Import/Export → Export Library**. No API key or scraping involved; Goodreads generates the file for you. The viewer detects it by its header row and converts it in the browser the same way as the SQLite path.

All three render in the same grid — the viewer doesn't care which one it came from.

### Goodreads-specific notes

- No per-passage highlights (Goodreads doesn't have that concept) — a non-empty "My Review" is surfaced instead, as a single highlight-like entry per book.
- No cover-lookup key equivalent to Kobo's `ImageId` — cover art for Goodreads books relies on the ISBN and title+author search tiers only (see "Cover art" below), so coverage will generally be lower than for Kobo-sourced books.
- No dedicated series column in Goodreads' export — series info is sometimes embedded in the title text itself (e.g. "Book Title (Series, #2)") but isn't parsed out.
- "Exclusive Shelf" maps to reading status: `read` → Finished (100%), `currently-reading` → Reading (0% — Goodreads doesn't track a reading percentage), anything else (`to-read`, custom shelves) → Unread.

Everything happens client-side: nothing is uploaded anywhere. A "⬇ Download JSON" button appears once a library is loaded, letting you save the converted data (useful when you loaded a `.sqlite` file and want to keep a portable JSON snapshot, or reload faster next time).

## Card design

Book cards are full-bleed poster tiles: the cover art fills the card, with a status pill (unread/reading/finished) and a highlight-count pill floating over the top corners, and title/author/progress overlaid at the bottom on a dark scrim. Books with no cover art fall back to a flat tinted panel with the same info centered in plain text instead of overlaid on an image — never a broken-image icon. Cards start in the fallback appearance and swap to the cover appearance the moment an image finishes loading (see "Cover art" below for where that image comes from).

This was explored as a design canvas (four directions: cover-forward, text-forward compact, refined-horizontal, and this poster-overlay one) before being built — the poster direction won out for browsing by cover art first.

## Cover art

Book cards show a cover thumbnail, tried in this order:

1. **Kobo's own cover CDN** (`cdn.kobo.com`), keyed by the book's `ImageId`. Since these are books bought/downloaded through Kobo's store, coverage is excellent — in testing, 16 of 19 candidate books resolved a real cover from this alone. Arguably the more private option too: Kobo already has this purchase on record, so nothing new is disclosed to a third party.
2. **[Open Library's cover CDN](https://openlibrary.org/dev/docs/api/covers)** (`covers.openlibrary.org`), keyed by ISBN, if step 1 fails (sideloaded books have no real `ImageId`, or Kobo just doesn't have that cover).
3. **Open Library's search API**, by title + author, if neither exact-identifier lookup applies or hits — this is the only tier that runs for books with no ImageId/ISBN at all (mostly sideloaded files). It's a fuzzy match, not an exact-identifier one: for an ambiguous or very common title it can occasionally return the wrong edition's cover, or the wrong book. Only attempted after tiers 1–2 are exhausted.
4. A plain placeholder icon if nothing above found a match.

In testing across the three tiers, 26 of 38 books resolved a real cover (16 Kobo, 10 via search — tier 2 wasn't needed this round since tier 1 or 3 always won first).

This is the one part of the viewer that isn't fully offline: loading a library makes requests to Open Library and/or Kobo's servers, revealing an ISBN, an ImageId, and/or a title+author pair to those services (public/low-sensitivity identifiers, not personal data, but worth knowing). Nothing errors or breaks either way — a failed lookup just falls through to the next tier, ending at the placeholder.

Both `ISBN` and `ImageId` sometimes hold fallback junk instead of real values (Kobo stuffs a `urn:uuid:...` into `ISBN`, or a mangled sideloaded file path into `ImageId`, when it doesn't have the real thing). The viewer validates the shape of both before ever using them in an exact-identifier lookup, so junk values never get sent to tiers 1–2 (tier 3 only ever uses the book's title/author, which are already just metadata you're viewing anyway).

`ImageId` is only present in exports produced by [export.py](../exporter/export.py) after this feature was added — a `library.json` from an older export won't have it and will skip straight to tiers 2–3. Re-run the exporter against your device to pick it up.

**Considered and ruled out for now:** the Google Books API (free-tier anonymous access is currently hard-capped at 0 requests/day — it now requires the user's own Google Cloud API key, which is real setup friction for what's meant to be a zero-config tool). Amazon, Goodreads, WorldCat/xISBN, and LibraryThing don't offer a workable free/keyless covers API either.

## How SQLite parsing works

`viewer/vendor/kobo-sqljs-bundle.js` vendors [sql.js](https://github.com/sql-js/sql.js) (MIT licensed) — SQLite compiled to WebAssembly — with the `.wasm` binary embedded as a base64 string inside the JS file itself, rather than fetched separately. This is deliberate: `fetch()`/`XMLHttpRequest()` of local files is blocked by Chrome's CORS policy when a page is opened via `file://` (as most people will open this viewer), but a `<script src="...">` tag loading a local `.js` file is not subject to that restriction. Bundling the WASM as inline base64 and passing it to sql.js via the `wasmBinary` option sidesteps the fetch requirement entirely, so the whole thing works from a plain double-click with no server and no internet access.

The SQLite → JSON conversion logic in `index.html` (column lists, the `content`/`Bookmark` table queries, the top-level-book filter) mirrors [`exporter/export.py`](../exporter/export.py) exactly, so a `.sqlite` file converted here produces the same shape as the CLI's output.

## Regenerating the vendor bundle

If sql.js needs updating, rebuild the bundle from a fresh release:

```bash
cd viewer/vendor
curl -sL -o sql-wasm.wasm https://cdnjs.cloudflare.com/ajax/libs/sql.js/<version>/sql-wasm.wasm
curl -sL -o sql-wasm.js https://cdnjs.cloudflare.com/ajax/libs/sql.js/<version>/sql-wasm.js
{
  printf '/* sql.js (SQLite compiled to WebAssembly) — vendored for offline use in the Kobo Library Viewer. */\n';
  printf '/* Original project: https://github.com/sql-js/sql.js (MIT license) */\n';
  printf 'var SQL_WASM_BASE64 = "';
  base64 -w0 sql-wasm.wasm;
  printf '";\n\n';
  cat sql-wasm.js;
} > kobo-sqljs-bundle.js
rm sql-wasm.wasm sql-wasm.js
```
