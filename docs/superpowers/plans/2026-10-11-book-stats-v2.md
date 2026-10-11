# Book Stats v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tier lists declare at creation whether their top tier is the best or the worst and book stats respect it (PR C); book stats render as big-number tiles and one picture per Stats-page section, with tier standing in words (PR D).

**Architecture:** PR C adds an immutable `ranks_worst_first` column end to end (schema → create route → shared types → creation UIs → voter caption) and flips worst-first positions in the works stats service. PR D reshapes the shared `bookStatsModel` additively (tiles, feeling columns, tier bar, tournament path), switches web then mobile to it, then deletes the old fields and the tier letter.

**Tech Stack:** Fastify + node:sqlite, `@scripta/shared` (node:test), React/Vite/Tailwind (`tsx --test scripts/test-*.mts`), Expo Router/React Native.

**Spec:** `docs/superpowers/specs/2026-10-11-book-stats-v2-design.md`

## Global Constraints

- `ranks_worst_first`: `INTEGER NOT NULL DEFAULT 0`; API field `ranksWorstFirst: boolean`; settable only by `POST /tierlists`; never by `PUT /tierlists/:id`, open-voting or voting-state routes.
- Creation copy: legend/label "Top tier means", options "Best" (default) and "Worst", hint "Can't be changed later."
- Voter caption, only when worst-first: "Top tier = worst".
- Stats flip: `position = index / (tierCount - 1)`, then `1 - position` when worst-first; 1-tier lists skipped; lists weighted equally; minimum 3.
- Bands: `["Top tier", "Upper tiers", "Middle", "Lower tiers", "Bottom tier"][Math.min(4, Math.floor(score * 5))]`.
- Tiles, in order, each only when its data exists: Open Library `4.4` / `★ Open Library`; community average `3.8` / nearest feeling; tiers band's first word / rest of band + `· N list(s)`; tournaments `🏆` / `Winner` or best round label or `Entered`.
- No `Intl` in shared code. No code comments. Stage and commit in one command. Run git from the worktree root.
- Backend test files are listed explicitly in `backend/package.json` `test`; a new backend test file must be appended there.
- After `packages/shared` changes, `npm run build --workspace @scripta/shared` before other packages' typechecks.
- Merging: use the PR number `gh pr create` prints (or run `gh pr merge --merge --auto` from the branch with no number). Never guess a PR number.

## Review Focus

1. An existing production tier list (created before this change) must keep counting as best-first and stay editable/votable — retrofit test in Task 1.
2. A client sending `ranksWorstFirst` on `PUT /tierlists/:id` must not flip a list — route test in Task 1.
3. A book whose only tier votes come from a worst-first list must land in "Bottom tier" when voters put it in the top tier — stats test in Task 1.
4. On the desktop web sidebar (220px), four tiles must stay readable (they wrap 2×2) — browser check in Task 4.
5. Narrow Android tiles must not clip the big value; captions may wrap to two lines — device pass in Task 5.

---

## Part 1 — PR C: tier list direction (branch `claude/book-stats-v2`)

### Task 1: Backend + shared — `ranks_worst_first` end to end, stats flip

**Files:**
- Modify: `backend/src/modules/tierlists/adapters/sqlite/schema.sql` (tierlists table, after `public_books`)
- Modify: `backend/src/modules/tierlists/adapters/sqlite/connection.ts` (retrofit block ~L29-38)
- Modify: `backend/src/modules/tierlists/domain/types.ts` (`TierlistRow`, `TierPlacement`)
- Modify: `backend/src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.ts` (`insertStmt` L12-15, `insert()` ~L191-203, `tierPlacementsStmt` L47-54, `tierPlacements()` L317-329)
- Modify: `backend/src/modules/tierlists/service.ts` (`toTierlist` L12-26, `VotingBoard` L35-55 + wherever it is built, `createTierlist` interface L92 and impl L219-242)
- Modify: `backend/src/modules/tierlists/routes.ts` (`createTierlistSchema` L30-34, `POST /tierlists` L90-105, voting board response L300-313)
- Modify: `backend/src/modules/works/stats.ts`
- Modify: `packages/shared/src/tierlists/types.ts` (`Tierlist`, `VotingBoard`), `packages/shared/src/tierlists/api.ts` (`createTierlist`), `packages/shared/src/tierlists/api.test.ts`
- Test: `backend/src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.test.ts`, `backend/src/modules/tierlists/routes.test.ts`, `backend/src/modules/works/stats.test.ts`; fix literals in `backend/src/modules/tierlists/service.test.ts` and any other `TierlistRow` literal (`rg -n "public_books:" backend/src`)

**Interfaces:**
- Produces: `TierlistRow.ranks_worst_first: number`; `TierPlacement.ranksWorstFirst: boolean`; `Tierlist.ranksWorstFirst: boolean`; `VotingBoard.ranksWorstFirst: boolean` (backend and shared); `createTierlist(name: string, data?: TierlistData, access?: Access, ranksWorstFirst?: boolean)` (shared API); `TierlistsService.createTierlist(userId, name, data?, access?, publicBooks?, ranksWorstFirst?: boolean)`; `BookStatsDeps.tierPlacements` returns `Array<{ tierlistId; tierIndex; tierCount; ranksWorstFirst: boolean }>`.

- [ ] **Step 1: Failing tests**

Repository test (append):
```ts
test("an existing tierlists table gains ranks_worst_first, defaulting to best-first", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE tierlists (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  db.prepare(`INSERT INTO tierlists (id, owner_user_id, name, created_at, updated_at) VALUES ('old', 'u1', 'Old', '2026-01-01', '2026-01-01')`).run();
  applyTierlistsMigrations(db);
  assert.equal((db.prepare(`SELECT ranks_worst_first FROM tierlists WHERE id = 'old'`).get() as { ranks_worst_first: number }).ranks_worst_first, 0);
});

test("insert stores ranks_worst_first and tierPlacements reports it", () => {
  const repo = createSqliteTierlistsRepository(freshDb());
  const tiers = JSON.stringify({ tiers: [{ id: "s", label: "S", color: "#fff", workIds: [] }, { id: "d", label: "D", color: "#000", workIds: [] }], pool: ["w"] });
  repo.insert(row({ id: "worst", vote_code: "code-worst", voting_open: 1, data: tiers, ranks_worst_first: 1 }));
  repo.saveBallot(ballot({ id: "b1", tierlist_id: "worst", voter_user_id: "u1" }), [{ workId: "w", tierId: "s" }]);
  assert.equal(repo.getOwned("worst", "u1")!.ranks_worst_first, 1);
  assert.deepEqual(repo.tierPlacements(["w"]), [{ tierlistId: "worst", tierIndex: 0, tierCount: 2, ranksWorstFirst: true }]);
});
```
Add `ranks_worst_first: 0` to the `row()` helper's defaults. `applyTierlistsMigrations` is already imported at the top of the file (L19). If the minimal old-table shape above is missing a column the migration needs (it runs `migrateTierlistsToWorks`), copy the oldest table shape an existing migration test in this file uses.

Routes test (append, following the existing `POST /tierlists` test at ~L212 for app setup and auth headers):
```ts
test("ranksWorstFirst is set at creation, returned, and cannot be changed by an update", async () => {
  // build the app and a signed-in user exactly as the create test at ~L212 does
  const created = await app.inject({ method: "POST", url: "/tierlists", headers, payload: { name: "Worst of 2024", ranksWorstFirst: true } });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().ranksWorstFirst, true);
  const id = created.json().id;
  const updated = await app.inject({ method: "PUT", url: `/tierlists/${id}`, headers, payload: { name: "Renamed", ranksWorstFirst: false } });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().ranksWorstFirst, true);
  const plain = await app.inject({ method: "POST", url: "/tierlists", headers, payload: { name: "Best of 2024" } });
  assert.equal(plain.json().ranksWorstFirst, false);
});
```
and extend the existing voting-board GET test (the one asserting the board's fields, near L300-313's route) with `assert.equal(res.json().board.ranksWorstFirst, false);` — and, if that test creates its list through the service, a second list created with `ranksWorstFirst: true` asserting `true`.

Stats test (append to `backend/src/modules/works/stats.test.ts`; existing fixtures gain `ranksWorstFirst: false`):
```ts
test("a worst-first list's top tier counts as the bottom", () => {
  const worst = Array.from({ length: 3 }, () => ({ tierlistId: "worst", tierIndex: 0, tierCount: 5, ranksWorstFirst: true }));
  assert.equal(stats({ tierPlacements: () => worst })!.tiers!.score, 1);
  const mixed = [...worst, ...Array.from({ length: 3 }, () => ({ tierlistId: "best", tierIndex: 0, tierCount: 5, ranksWorstFirst: false }))];
  assert.equal(stats({ tierPlacements: () => mixed })!.tiers!.score, 0.5);
});
```

Shared API test: change the `createTierlist` case to
```ts
["createTierlist", (api) => api.createTierlist("N", data, "members", true), "/tierlists", { method: "POST", body: { name: "N", data, access: "members", ranksWorstFirst: true }, auth: "required" }],
```

- [ ] **Step 2: Run, expect FAIL** — `cd backend && npx tsx --test src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.test.ts src/modules/tierlists/routes.test.ts src/modules/works/stats.test.ts`; `cd packages/shared && node --import tsx --test src/tierlists/api.test.ts`.

- [ ] **Step 3: Implement**
- `schema.sql`: `  ranks_worst_first  INTEGER NOT NULL DEFAULT 0,` after `public_books`.
- `connection.ts`: `if (!has("ranks_worst_first")) db.exec(\`ALTER TABLE tierlists ADD COLUMN ranks_worst_first INTEGER NOT NULL DEFAULT 0\`);` beside the other retrofits.
- `domain/types.ts`: `ranks_worst_first: number;` on `TierlistRow` (after `public_books`); `ranksWorstFirst: boolean;` on `TierPlacement`.
- Repository: add `ranks_worst_first` to the INSERT column list and `$ranks_worst_first` to VALUES; bind `$ranks_worst_first: row.ranks_worst_first` in `insert()`. `tierPlacementsStmt` selects `t.ranks_worst_first` too; the row type gains `ranks_worst_first: number`; the mapped object gains `ranksWorstFirst: row.ranks_worst_first === 1`.
- Service: `toTierlist` adds `ranksWorstFirst: row.ranks_worst_first === 1`; `createTierlist(userId, name, data, access, publicBooks, ranksWorstFirst = false)` sets `ranks_worst_first: ranksWorstFirst ? 1 : 0` (interface signature too); backend `VotingBoard` gains `ranksWorstFirst: boolean`, set from the row where the board is built (`rg -n "eligibleVoteCount:" backend/src/modules/tierlists/service.ts`).
- Routes: `createTierlistSchema` gains `ranksWorstFirst: z.boolean().optional()`; the handler destructures it and passes it as the sixth argument; the voting board response adds `ranksWorstFirst: board.ranksWorstFirst`.
- `works/stats.ts`: the placement type gains `ranksWorstFirst: boolean`; in `tiers()` compute `const position = placement.tierIndex / (placement.tierCount - 1);` and push `placement.ranksWorstFirst ? 1 - position : position`.
- Shared: `Tierlist` and `VotingBoard` gain `ranksWorstFirst: boolean`; `createTierlist(name, data?, access?, ranksWorstFirst?)` sends `body: { name, data, access, ranksWorstFirst }`.
- Fix every `TierlistRow` literal (`service.test.ts` in-memory repo, other fixtures) with `ranks_worst_first: 0`, and every `TierPlacement` fixture with `ranksWorstFirst: false`.

- [ ] **Step 4: Run, expect PASS** — the Step 2 commands, then `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`, then `npm run typecheck --workspace frontend` and `cd mobile && EXPO_PUBLIC_API_URL=http://localhost:3000 npm run typecheck` (client typechecks must stay green: the new fields are additive).

- [ ] **Step 5: Commit**
```bash
git add backend packages/shared && git commit -m "Let a tier list rank its worst books first, fixed at creation" -m "Book stats flip worst-first lists so their top tier counts as the bottom." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Clients — direction at creation, caption for voters

**Files:**
- Modify: `frontend/src/hooks/useTierlists.ts` (`create`, ~L33)
- Modify: `frontend/src/pages/TierListCreatePage.tsx` (state ~L18-19, `submit` L31, step 2 ~L76-88)
- Modify: `frontend/src/pages/VoteTierlistPage.tsx` (both `<header>` blocks, ~L122 and ~L180)
- Modify: `mobile/src/features/tierlists/TierlistCreateScreen.tsx` (constants L10-11, state, `create` L36, step 2 ~L76-84)
- Modify: `mobile/src/features/tierlists/VoteTierlistScreen.tsx` (`TierHead` caption ~L132)

**Interfaces:**
- Consumes: `createTierlist(..., ranksWorstFirst?)`, `VotingBoard.ranksWorstFirst` (Task 1).

- [ ] **Step 1: Web creation** — `useTierlists.create` gains a fourth parameter `ranksWorstFirst?: boolean` passed through to `createTierlist`. In `TierListCreatePage`: `const [worstFirst, setWorstFirst] = useState(false);`; `submit` passes `worstFirst` as the fourth argument; at the top of step 2, before the Visibility fieldset:
```tsx
<fieldset className="flex flex-col gap-3"><legend className="mb-2 font-semibold">Top tier means</legend>
  {([false, true] as const).map((value) => <label key={String(value)} className="flex items-center gap-2 rounded-lg border border-(--color-border) p-3"><input type="radio" checked={worstFirst === value} onChange={() => setWorstFirst(value)} />{value ? "Worst" : "Best"}</label>)}
  <p className="text-sm text-(--color-text-dim)">Can't be changed later.</p>
</fieldset>
```

- [ ] **Step 2: Web voter caption** — in `VoteTierlistPage`, directly after each of the two `</header>` closings add `{board.ranksWorstFirst ? <p className="mb-2 text-xs text-(--color-text-dim)">Top tier = worst</p> : null}`.

- [ ] **Step 3: Mobile creation** — add `const DIRECTION = [{ value: "best", label: "Best" }, { value: "worst", label: "Worst" }] as const;` beside `VISIBILITY`; state `const [direction, setDirection] = useState<"best" | "worst">("best");`; `create()` passes `direction === "worst"` as the fourth argument to `createTierlist`; at the top of the step-2 `View`:
```tsx
<Text {...dynamicType} style={[typography.body, { color: colors.text }]}>Top tier means</Text>
<Segmented accessibilityLabel="Top tier means" options={DIRECTION} value={direction} onChange={setDirection} />
<Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>Can't be changed later.</Text>
```

- [ ] **Step 4: Mobile voter caption** — in `VoteTierlistScreen`, render `{board.ranksWorstFirst ? <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>Top tier = worst</Text> : null}` as its own row above `TierHead` on the My board page and above `TierlistResults` on the Community page.

- [ ] **Step 5: Verify** — `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`; `cd mobile && EXPO_PUBLIC_API_URL=http://localhost:3000 npm run typecheck && EXPO_PUBLIC_API_URL=http://localhost:3000 npm test`. Browser check (dev slot per `docs/dev-workflow.md`, release after): create a public worst-first tier list on web → its vote page shows "Top tier = worst"; a best-first one doesn't; the creation step shows the control and hint.

- [ ] **Step 6: Commit**
```bash
git add frontend mobile && git commit -m "Choose a tier list's direction at creation and show worst-first lists to voters" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Device pass** — `device-checker` (after `node scripts/dev-status.mjs --json` shows the emulator free): mobile creation step 3 shows "Top tier means" Best/Worst + hint; creating a public worst-first list → its vote screen shows "Top tier = worst" as its own caption above the board header on both the My board and Community tabs; Android text not clipped.

### Ship PR C

- [ ] Whole-branch review (`branch-reviewer`) of Part 1; fix wave if needed.
- [ ] `git push -u origin HEAD`; `gh pr create --base main` (title "Tier lists: choose best-first or worst-first at creation"); `gh pr merge --merge --auto` from the branch (no number). Bind it with `ccd_pr`.
- [ ] Wait for it to merge (the app reports CI; don't poll). Then start Part 2 on a fresh branch from `origin/main`: `git worktree add -b claude/book-stats-tiles ../book-stats-tiles origin/main`.

---

## Part 2 — PR D: presentation (branch `claude/book-stats-tiles`)

### Task 3: Shared model — tiles, feeling columns, tier bar, tournament path (additive)

**Files:**
- Modify: `packages/shared/src/works/bookStats.ts`
- Modify: `packages/shared/src/works/bookStats.test.ts`

**Interfaces:**
- Produces (added to `bookStatsModel`'s return, old fields untouched until Task 5):
```ts
export type TierBand = "Top tier" | "Upper tiers" | "Middle" | "Lower tiers" | "Bottom tier";
export function tierBand(score: number): TierBand;
tiles: Array<{ key: "openLibrary" | "community" | "tiers" | "tournaments"; value: string; caption: string }>;
ratings.community.columns: Array<{ label: string; count: number; fraction: number; top: boolean }>; // "Not for me" … "All-time"
tierBar: { band: TierBand; marker: number; summary: string } | null;
tournamentRun: { path: Array<{ label: string; reached: boolean }>; champion: boolean; summary: string } | null;
```

- [ ] **Step 1: Failing tests** — append to `bookStats.test.ts` (reuses the file's `full` and `openLibrary` fixtures):
```ts
import { tierBand } from "./bookStats.js";

test("tier bands split the range into five equal parts", () => {
  assert.deepEqual([0, 0.19, 0.2, 0.4, 0.6, 0.8, 1].map(tierBand), ["Top tier", "Top tier", "Upper tiers", "Middle", "Lower tiers", "Bottom tier", "Bottom tier"]);
});

test("tiles: big value and caption for each stat that exists", () => {
  assert.deepEqual(bookStatsModel(full, openLibrary).tiles, [
    { key: "openLibrary", value: "4.1", caption: "★ Open Library" },
    { key: "community", value: "3.8", caption: "Loved it" },
    { key: "tiers", value: "Upper", caption: "tiers · 4 lists" },
    { key: "tournaments", value: "🏆", caption: "Winner" }
  ]);
});

test("tile captions follow the band and the counts", () => {
  const tile = (score: number, lists: number) => bookStatsModel({ community: null, tiers: { score, letter: "S", lists, ballots: 3 }, tournaments: null }, null).tiles[0];
  assert.deepEqual(tile(0, 1), { key: "tiers", value: "Top", caption: "tier · 1 list" });
  assert.deepEqual(tile(0.5, 2), { key: "tiers", value: "Middle", caption: "2 lists" });
  assert.deepEqual(tile(0.9, 3), { key: "tiers", value: "Bottom", caption: "tier · 3 lists" });
  const run = (best: { round: number; duels: number } | null) => bookStatsModel({ community: null, tiers: null, tournaments: { entered: 1, titles: 0, wins: 0, losses: 0, best } }, null).tiles[0];
  assert.deepEqual(run({ round: 2, duels: 2 }), { key: "tournaments", value: "🏆", caption: "Semis" });
  assert.deepEqual(run(null), { key: "tournaments", value: "🏆", caption: "Entered" });
  assert.deepEqual(bookStatsModel(null, openLibrary).tiles.map((t) => t.key), ["openLibrary"]);
});

test("feeling columns run from Not for me to All-time and mark the tallest", () => {
  const { columns } = bookStatsModel(full, openLibrary).ratings.community!;
  assert.deepEqual(columns.map((c) => [c.label, c.count, c.top]), [["Not for me", 1, false], ["Fine", 0, false], ["Good", 2, false], ["Loved it", 6, true], ["All-time", 3, false]]);
  assert.equal(columns[3]!.fraction, 1);
  const tied = bookStatsModel({ community: { average: 3, count: 4, distribution: [2, 0, 0, 2, 0] }, tiers: null, tournaments: null }, null).ratings.community!.columns;
  assert.deepEqual(tied.map((c) => c.top), [true, false, false, true, false]);
});

test("tier bar carries the band, a marker at the score and the summary", () => {
  assert.deepEqual(bookStatsModel(full, null).tierBar, { band: "Upper tiers", marker: 0.31, summary: "Across 4 published tier lists · 23 votes" });
  assert.equal(bookStatsModel({ community: null, tiers: null, tournaments: null }, null).tierBar, null);
});

test("tournament path walks the best run from round 1 to the final", () => {
  const run = (titles: number, best: { round: number; duels: number } | null, entered = 1, wins = 2, losses = 1) =>
    bookStatsModel({ community: null, tiers: null, tournaments: { entered, titles, wins, losses, best } }, null).tournamentRun;
  assert.deepEqual(run(0, { round: 2, duels: 2 })!.path, [{ label: "Quarters", reached: true }, { label: "Semis", reached: true }, { label: "Final", reached: false }]);
  assert.deepEqual(run(0, { round: 1, duels: 2 })!.path, [{ label: "Semis", reached: true }, { label: "Final", reached: false }]);
  const won = run(1, { round: 6, duels: 1 }, 2, 6, 1)!;
  assert.deepEqual(won.path.map((s) => s.label), ["Round 1", "Round 2", "Round 3", "Quarters", "Semis", "Final"]);
  assert.ok(won.path.every((s) => s.reached));
  assert.equal(won.champion, true);
  assert.equal(won.summary, "2 tournaments · 6 won, 1 lost · 1 title");
  assert.deepEqual(run(0, null, 1, 0, 0), { path: [], champion: false, summary: "1 tournament · 0 won, 0 lost · 0 titles" });
});
```
Check `roundLabel(4, 1)` returns "Quarters" and `roundLabel(2, 1)` "Semis" (`packages/shared/src/arena/arenaBracket.ts:21-26`; it keys on the round's duel count). The `full` fixture's `tiers.score` is 0.31 → "Upper tiers".

- [ ] **Step 2: Run, expect FAIL** — `cd packages/shared && node --import tsx --test src/works/bookStats.test.ts`.

- [ ] **Step 3: Implement** — in `bookStats.ts`:
```ts
const TIER_BANDS = ["Top tier", "Upper tiers", "Middle", "Lower tiers", "Bottom tier"] as const;
export type TierBand = (typeof TIER_BANDS)[number];
export function tierBand(score: number): TierBand {
  return TIER_BANDS[Math.min(4, Math.floor(score * 5))]!;
}

function tierTile(band: TierBand, lists: number) {
  const [value, ...rest] = band.split(" ");
  const listCount = plural(lists, "list", "lists");
  return { value: value!, caption: rest.length > 0 ? `${rest.join(" ")} · ${listCount}` : listCount };
}

function tournamentPath(record: TournamentRecord) {
  if (!record.best) return [];
  const finalRound = record.best.round + Math.log2(record.best.duels);
  return Array.from({ length: finalRound }, (_, index) => {
    const round = index + 1;
    return { label: roundLabel(2 ** (finalRound - round), round), reached: round <= record.best!.round };
  });
}
```
and inside `bookStatsModel`, build and return alongside the existing fields:
```ts
const tiles: Array<{ key: StripKey; value: string; caption: string }> = [];
if (openLibrary) tiles.push({ key: "openLibrary", value: openLibrary.value.toFixed(1), caption: "★ Open Library" });
if (community) tiles.push({ key: "community", value: community.average.toFixed(1), caption: feelingFor(community.average) });
if (tiers) tiles.push({ key: "tiers", ...tierTile(tierBand(tiers.score), tiers.lists) });
if (tournaments) tiles.push({ key: "tournaments", value: "🏆", caption: bestFinish(tournaments) ?? "Entered" });
```
`ratings.community` gains
```ts
columns: FINISH_FEELINGS.map((feeling) => {
  const count = community.distribution[feeling.rating - 1]!;
  return { label: feeling.label as string, count, fraction: largest > 0 ? count / largest : 0, top: largest > 0 && count === largest };
})
```
and the return gains
```ts
tierBar: tiers ? { band: tierBand(tiers.score), marker: tiers.score, summary: `Across ${plural(tiers.lists, "published tier list", "published tier lists")} · ${plural(tiers.ballots, "vote", "votes")}` } : null,
tournamentRun: tournaments ? { path: tournamentPath(tournaments), champion: tournaments.titles > 0, summary: `${plural(tournaments.entered, "tournament", "tournaments")} · ${tournaments.wins} won, ${tournaments.losses} lost · ${plural(tournaments.titles, "title", "titles")}` } : null,
```

- [ ] **Step 4: Run, expect PASS** — `cd packages/shared && node --import tsx --test src/works/bookStats.test.ts && npm run typecheck && npm test && npm run build`.

- [ ] **Step 5: Commit**
```bash
git add packages/shared/src/works && git commit -m "Add tiles, feeling columns, tier bands and tournament paths to the book stats model" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Web — tiles and the new Stats page sections

**Files:**
- Modify: `frontend/src/components/book/BookStats.tsx` (rename `StatsStrip` → `StatsTiles`, rewrite `StatsSections`)
- Modify: `frontend/src/components/book/BookScreen.tsx` (L32 import, L64, L186)
- Modify: `frontend/scripts/test-book-stats.mts`, `frontend/scripts/test-work-page.mts` (strip assertions)

**Interfaces:**
- Consumes: `tiles`, `ratings.community.columns`, `tierBar`, `tournamentRun`, `tiersEmpty`, `tournamentsEmpty` (Task 3).
- Produces: `StatsTiles({ tiles, to }: { tiles: BookStatsModel["tiles"]; to: string })`; `StatsSections({ model })`.

- [ ] **Step 1: Failing tests** — in `test-book-stats.mts`, replace the strip/sections tests with:
```ts
const tiles = (stats: BookStats | null, ol: typeof rating | null) =>
  renderToString(createElement(MemoryRouter, null, createElement(StatsTiles, { tiles: bookStatsModel(stats, ol).tiles, to: "/work/w/stats" })));

test("tiles link to the stats page with a big value and caption each", () => {
  const html = tiles(full, rating);
  assert.ok(html.includes('href="/work/w/stats"'));
  assert.ok(html.includes("Book stats: "));
  for (const text of ["4.1", "★ Open Library", "3.8", "Loved it", "Upper", "tiers · 4 lists", "🏆", "Winner"]) assert.ok(html.includes(text), text);
});

test("no tiles, nothing rendered; loading shows only Open Library", () => {
  assert.equal(tiles(null, null), "");
  const html = tiles(null, rating);
  assert.ok(html.includes("★ Open Library"));
  assert.ok(!html.includes("Loved it"));
});

test("sections: feeling columns, tier bar, bracket path", () => {
  const html = sections(full, rating);
  for (const text of ["Ratings", "Loved it", "3.8 average · 12 ratings", "Not for me", "All-time", "Tier lists", "Upper tiers", "Top", "Bottom", "Across 4 published tier lists · 23 votes", "Tournaments", "Final", "3 tournaments · 7 won, 2 lost · 1 title"]) assert.ok(html.includes(text), text);
  assert.ok(html.includes("left:31%"));
  assert.ok(html.includes("height:100%"));
});
```
Keep the "empty sections say why" test. Adjust the `left:`/`height:` assertions to the exact style string `renderToString` emits if it differs (check once). In `test-work-page.mts`, the strip test keeps `href="/work/w/stats"` and changes `"★ 4.3"` to `"4.3"` and `"★ Open Library"`.

Run `cd frontend && npx tsx --tsconfig tsconfig.app.json --test scripts/test-book-stats.mts` → FAIL.

- [ ] **Step 2: Implement** `BookStats.tsx`:
```tsx
export function StatsTiles({ tiles, to }: { tiles: BookStatsModel["tiles"]; to: string }) {
  if (tiles.length === 0) return null;
  return (
    <Link to={to} className="mt-3 flex flex-wrap gap-2 rounded-xl text-center hover:opacity-90">
      <span className="sr-only">Book stats: </span>
      {tiles.map((tile) => (
        <span key={tile.key} className="min-w-0 grow basis-[4.5rem] rounded-xl border border-(--color-border) bg-(--color-surface) px-2 py-2">
          <span className="block truncate text-xl font-bold">{tile.value}</span>
          <span className="line-clamp-2 block text-xs text-(--color-text-dim)">{tile.caption}</span>
        </span>
      ))}
    </Link>
  );
}
```
`StatsSections`:
- Ratings: Open Library line; when `ratings.community`: feeling `text-2xl font-bold`, summary dim, then
```tsx
<div className="mt-3 flex h-24 items-end gap-2">
  {ratings.community.columns.map((column) => (
    <span key={column.label} aria-label={`${column.label}: ${column.count}`} className={`min-h-[2px] flex-1 rounded-t ${column.top ? "bg-(--color-accent)" : "bg-(--color-border)"}`} style={{ height: `${Math.round(column.fraction * 100)}%` }} />
  ))}
</div>
<div className="mt-1 flex gap-2 text-center text-xs text-(--color-text-dim)">
  {ratings.community.columns.map((column) => <span key={column.label} className="flex-1">{column.label}</span>)}
</div>
```
  then the empty line.
- Tier lists: when `tierBar`:
```tsx
<p className="text-2xl font-bold">{tierBar.band}</p>
<div className="relative mt-3 h-2 rounded-full bg-(--color-border)">
  <span className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-(--color-accent)" style={{ left: `${Math.round(tierBar.marker * 100)}%` }} />
</div>
<div className="mt-1 flex justify-between text-xs text-(--color-text-dim)"><span>Top</span><span>Bottom</span></div>
<p className={`${dim} mt-2`}>{tierBar.summary}</p>
```
  else `tiersEmpty`.
- Tournaments: when `tournamentRun`:
```tsx
{tournamentRun.path.length > 0 ? (
  <ol className="flex flex-wrap items-center gap-1.5 text-sm">
    {tournamentRun.path.map((step) => (
      <li key={step.label} className="flex items-center gap-1.5">
        <span className={`rounded-full border px-2.5 py-0.5 ${step.reached ? "border-(--color-accent) bg-(--color-accent-soft) font-semibold text-(--color-accent)" : "border-(--color-border) text-(--color-text-dim)"}`}>{step.label}</span>
        <span aria-hidden="true" className="text-(--color-text-dim)">→</span>
      </li>
    ))}
    <li><span className={`rounded-full border px-2.5 py-0.5 ${tournamentRun.champion ? "border-(--color-accent) bg-(--color-accent-soft)" : "border-(--color-border) opacity-50"}`}>🏆</span></li>
  </ol>
) : null}
<p className={`${dim} mt-2`}>{tournamentRun.summary}</p>
```
  else `tournamentsEmpty`.

`BookScreen.tsx`: import `StatsTiles`; `const statsTiles = bookStatsModel(...).tiles;`; render `<StatsTiles tiles={statsTiles} to={...} />` in the same place.

- [ ] **Step 3: Verify** — the two test scripts + `test-work-stats-page.mts`, `npm run typecheck`, `npm run lint`, `npm test` in `frontend`. Browser check at 1280px (220px sidebar: four tiles wrap 2×2, three wrap 2+1 with the last full width) and 390px (up to four in one row), Stats page sections render with a fixture book that has tournament and tier data ("The Fellowship of the Ring": tier + tournament; "A Game of Thrones": tournament). Screenshots in the SDD workspace.

- [ ] **Step 4: Commit**
```bash
git add frontend && git commit -m "Show book stats as tiles and give each Stats page section its own picture on web" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Mobile — tiles and sections; remove the old model fields and the tier letter

**Files:**
- Modify: `mobile/src/features/works/BookStats.tsx`, `mobile/src/features/works/BookScreen.tsx` (L12 import, L84, L116)
- Modify: `packages/shared/src/works/bookStats.ts`, `packages/shared/src/works/bookStats.test.ts` (remove old fields)
- Modify: `backend/src/modules/works/stats.ts`, `backend/src/modules/works/stats.test.ts` (drop `letter`)

**Interfaces:**
- Consumes: Task 3's fields.
- Produces (final): `TierStanding = { score: number; lists: number; ballots: number }`; `bookStatsModel` returns `{ tiles, ratings: { openLibrary, community: { feeling, summary, columns } | null, empty }, tierBar, tiersEmpty, tournamentRun, tournamentsEmpty }`; no `strip`, `bars`, `tiers`, `tournaments` (array), `tierLetter`, `TierLetter`.

- [ ] **Step 1: Mobile components** — `BookStats.tsx`: `StatsTiles({ tiles, onPress })`:
```tsx
<Pressable accessibilityRole="button" accessibilityLabel={`Book stats: ${tiles.map((tile) => `${tile.value} ${tile.caption}`).join("; ")}`} onPress={onPress} style={styles.tiles}>
  {tiles.map((tile) => (
    <View key={tile.key} style={[styles.tile, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Text numberOfLines={1} {...dynamicType} style={[typography.title, styles.strong, styles.center, { color: colors.text }]}>{tile.value}</Text>
      <Text numberOfLines={2} {...dynamicType} style={[typography.caption, styles.center, { color: colors.textDim }]}>{tile.caption}</Text>
    </View>
  ))}
</Pressable>
```
with `tiles: { alignSelf: "stretch", flexDirection: "row", gap: spacing.xs, marginTop: spacing.sm }`, `tile: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: radii.lg, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs, alignItems: "center" }`, `center: { textAlign: "center", alignSelf: "stretch" }`.

`StatsSections`:
- Ratings: Open Library line; feeling (`typography.heading`), summary, then a row `{ flexDirection: "row", alignItems: "flex-end", height: 96, gap: spacing.sm }` of five `View`s `{ flex: 1, height: \`${Math.round(column.fraction * 100)}%\`, minHeight: 2, borderTopLeftRadius: radii.sm, borderTopRightRadius: radii.sm, backgroundColor: column.top ? colors.accent : colors.border }` each with `accessibilityLabel={\`${column.label}: ${column.count}\`}`, and a label row of five `Text` (`typography.caption`, centred, `flex: 1`, `numberOfLines={2}`).
- Tier lists: band (`typography.heading`); a track `View` `{ height: 8, borderRadius: radii.full, backgroundColor: colors.border, marginTop: spacing.sm }` containing an absolutely positioned dot `{ position: "absolute", top: -4, width: 16, height: 16, borderRadius: 8, marginLeft: -8, left: \`${Math.round(marker * 100)}%\`, backgroundColor: colors.accent }`; a row with "Top" and "Bottom" captions (`justifyContent: "space-between"`); the summary.
- Tournaments: a wrapping row (`flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.xs`) of step pills (`borderWidth: 1, borderRadius: radii.full, paddingHorizontal: spacing.sm, paddingVertical: 2`; reached → `borderColor: colors.accent`, text `colors.accent` bold; else `colors.border` / `colors.textDim`) separated by "→" captions, ending with a "🏆" pill (dimmed with `opacity: 0.5` unless `champion`); then the summary.
- Empty lines as before.

`BookScreen.tsx`: import `StatsTiles`; `const statsTiles = bookStatsModel(...).tiles;`; render `<StatsTiles tiles={statsTiles} onPress={...} />` in the same place.

- [ ] **Step 2: Remove the old shape** — in `bookStats.ts` delete `TIER_LETTERS`, `TierLetter`, `tierLetter`, the `strip` array and its return, `bars` in `ratings.community`, the `tiers` and `tournaments` return entries; `TierStanding` loses `letter`. In `bookStats.test.ts` delete the tests for those (tier letters, strip, bars, sections built from `tiers`/`tournaments` arrays) and drop `letter` from fixtures. In `backend/src/modules/works/stats.ts` remove the `tierLetter` import and return `{ score, lists: byList.size, ballots }`; fix `stats.test.ts` expectations that include `letter`. `rg -n "tierLetter|TierLetter|\.letter\b|\.strip\b|\.bars\b|StatsStrip" packages frontend mobile backend` must return nothing.

- [ ] **Step 3: Verify** — `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend && npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`; `cd mobile && EXPO_PUBLIC_API_URL=http://localhost:3000 npm run typecheck && EXPO_PUBLIC_API_URL=http://localhost:3000 npm test`.

- [ ] **Step 4: Commit**
```bash
git add packages backend frontend mobile && git commit -m "Show book stats as tiles on mobile and drop the tier letter" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Device pass** — `device-checker`: tiles on The Hobbit (one tile, full width), A Game of Thrones (two), The Fellowship of the Ring (three) — big values not clipped, captions wrap to at most two lines; tapping opens Stats; Ratings section (empty line with fixture data), Tier lists bar with marker (Fellowship), Tournaments path with "Semis" reached and "Final"/🏆 dimmed (Fellowship, Game of Thrones); Back works; Android text not clipped.

### Ship PR D

- [ ] Whole-branch review (`branch-reviewer`) of Part 2; fix wave if needed.
- [ ] Push; `gh pr create --base main` ("Book stats: tiles, feeling columns, tier bands, tournament path"); `gh pr merge --merge --auto` from the branch. Bind with `ccd_pr`.

---

## Self-review notes

- Spec coverage: PR C data/immutability/creation UI/voter caption/stats flip/tests (Tasks 1–2); PR D model/tiles/sections/letter removal/tests (Tasks 3–5).
- Each commit leaves every package green: Task 1 is additive for clients; Task 3 is additive; Task 4 switches web; Task 5 switches mobile and only then removes the old fields.
