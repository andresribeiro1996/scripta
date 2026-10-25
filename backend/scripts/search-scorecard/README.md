# Search scorecard

Measures catalog search against a Jev-graded answer key. Spec: `docs/superpowers/specs/2026-10-25-volume-joins-and-search-ranking-design.md` (Parts 2–3).

- `queries.json`: 150 queries (50 hand-picked, 50 from Wikipedia's best-seller lists, 50 Portuguese). `hidden` marks the held-back third of each source, chosen by `sha1(q)` order.
- `grades.json`: `{ [q]: Grade[] }`. It stays empty (`{}`) until the first grading run, which lands with the ranking PR. Jev's grade for each (query, work) pair: `named` = 2, `related` = 1, `unrelated` = 0, times its confidence.

Everything runs read-only on the production container; there is no local snapshot. Branch code that isn't deployed is bundled with esbuild. `readonlyRepo.ts` opens `COVERS_DB_PATH` read-only and makes up for any schema the deploy doesn't have yet:
- a missing table becomes a TEMP table;
- missing columns come from a TEMP view whose triggers refuse writes.

`prod.mjs` uploads files to `/tmp` on the container in base64 chunks, runs the first one with `node`, and deletes the directory. Results go to stdout only.

## Commands (from the repo root)

1. Candidates:
   ```bash
   npx tsx backend/scripts/search-scorecard/bundle.ts backend/scripts/search-scorecard/candidates.ts /tmp/candidates.mjs
   node backend/scripts/search-scorecard/prod.mjs /tmp/candidates.mjs > ~/.cache/scripta/candidates.json
   ```
2. Grade a batch. Split `candidates.json` into `{ [q]: candidates[] }` files and gzip each one. Grading uses the server's `TYPESAFE_API_KEY` and the deployed `dist`, and reads no database:
   ```bash
   node backend/scripts/search-scorecard/prod.mjs backend/scripts/search-scorecard/grade.mjs batch-01.json.gz -- {dir}/batch-01.json.gz >> grades.jsonl
   ```
   Fold the `{ q, workId, grade, confidence }` lines into `grades.json`.
3. Score:
   ```bash
   npx tsx backend/scripts/search-scorecard/bundle.ts backend/scripts/search-scorecard/score.ts /tmp/score.mjs
   node backend/scripts/search-scorecard/prod.mjs /tmp/score.mjs -- --set tune
   ```
   It prints NDCG@10 per query, the tuning and hidden means, and search p50/p95. `--set` takes `tune` (the default), `hidden` or `all`.
4. Measure the Wikipedia term without writing to production. Fetch the sitelink map locally (public Wikidata, no database), upload it with the bundle, and point `--wikipedia` at it:
   ```bash
   node backend/scripts/fill-wikipedia-counts.mjs --out ~/.cache/scripta/wikipedia-sites.json
   node backend/scripts/search-scorecard/prod.mjs /tmp/score.mjs ~/.cache/scripta/wikipedia-sites.json -- --set tune --wikipedia {dir}/wikipedia-sites.json
   ```
   Run the first command from `backend/` after `npm run build --workspace backend`.
5. Hard-example orders in both search modes:
   ```bash
   npx tsx backend/scripts/search-scorecard/bundle.ts backend/scripts/search-scorecard/orders.ts /tmp/orders.mjs
   node backend/scripts/search-scorecard/prod.mjs /tmp/orders.mjs -- "harry potter" "lord of the rings" "dune"
   ```
6. Top up. The `TOPUP {…}` line on stderr lists works that appear in a top 10 but have no grade, with their labels. Grade them as a batch (step 2), add them to `grades.json`, and score again.

## Ship rule for a ranking change

- The tuning mean and the hidden mean are both above the baseline's.
- The hard examples pass: "harry potter", "lord of the rings", "dune".
- Search p95 is no more than 50 ms above the baseline's, measured back to back in one session.

Tune only on `--set tune`, and score the hidden set once before merging. Ranking code never names a book, an author or a query.
