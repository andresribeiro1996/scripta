# Book Stats UI (PR B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show book stats on the merged book screen (a tappable strip under the genre chips) and on a new `/work/:id/stats` page, on web and mobile.

**Architecture:** `@scripta/shared` gains `fetchWorkStats` beside `fetchWork`, and the book meta line stops printing the Open Library rating (the strip owns it now). Each client fetches stats with its own query (`["works", id, "stats"]`) so the book page never waits on it, renders the strip from `bookStatsModel(...).strip`, and renders the Stats page from the rest of the model. The backend (`GET /works/:id/stats`) and the model (`bookStatsModel`) already shipped in PR #221.

**Tech Stack:** `@scripta/shared` (node:test), React + Vite + Tailwind + react-query (web, `tsx --test scripts/test-*.mts`), Expo Router + React Native (mobile).

**Spec:** `docs/superpowers/specs/2026-10-11-book-stats-design.md` (sections "Shared model", "UI (PR B)", "Error handling"). Piece 1 spec for the screen it extends: `docs/superpowers/specs/2026-10-11-merged-book-screen-design.md`.

## Global Constraints

- Strip: up to four cells in the model's order, hidden when it has none, tapping it opens the Stats page. While stats load or if they fail, the strip shows only the Open Library cell (that is what `bookStatsModel(null, rating)` returns) — no error UI on the book screen.
- Meta line keeps year and pages only: `1965 · 412 pages`.
- Stats page: public on both clients like `/work/:id`; header/back plus the book title; three sections — Ratings, Tier lists, Tournaments — using the model's strings verbatim; bars are plain divs/views with percentage width (`fraction`), no chart library; loading → skeleton/“Loading…”, error → Retry, unknown id → the book page's not-found copy; canonical-id redirect like the book page.
- No stats query when there is no work (`page === null`, the library-only `/book/<key>` screen).
- Query keys: work `["works", id]` (existing), stats `["works", id, "stats"]`.
- No `Intl` calls in shared code (Hermes).
- No code comments. Stage and commit in one command. Run git from the worktree root `/Users/andreribeiro/Documents/scripta/.claude/worktrees/book-stats-ui`.
- After `packages/shared` changes run `npm run build --workspace @scripta/shared` before client typechecks.

## Review Focus

1. A book page opened for a work with no stats at all and no Open Library rating must show no strip and no empty box — tests in Tasks 2 (web render) and 3 (device pass).
2. A merged-away work id opened at `/work/<old>/stats` must land on the canonical id's stats page, not 404 — redirect in Tasks 2 and 3 (web test; device pass covers mobile).
3. A signed-out visitor on a shared `/work/:id/stats` link (web public route, mobile `(public)` group) must see the page — route placement in Tasks 2 and 3.
4. The stats request failing (500/429) must leave the book screen intact with only the Open Library cell — web render test in Task 2.
5. On mobile, a book opened from the Arena tab must open its Stats page inside the Arena stack, and one opened from a root-level screen inside `(public)` — `workStatsPath` test in Task 3.

---

### Task 1: Shared — `fetchWorkStats`, meta line without the rating

**Files:**
- Modify: `packages/shared/src/works/api.ts`, `packages/shared/src/works/api.test.ts`
- Modify: `packages/shared/src/works/bookScreen.ts:31-50`, `packages/shared/src/works/bookScreen.test.ts:91-105`
- Modify: `frontend/scripts/test-work-page.mts:48` (the meta assertion changes with it)

**Interfaces:**
- Produces: `createWorksApi(request).fetchWorkStats(id: string): Promise<BookStats>`; `bookMetaLine(work: Pick<WorkPage["work"], "year" | "pages">): string | null`.

- [ ] **Step 1: Failing tests**

`api.test.ts`, append:
```ts
test("fetchWorkStats is optional-auth and encodes the id", async () => {
  const calls: Array<{ path: string; init: ApiRequestInit }> = [];
  const request = (async (path: string, init: ApiRequestInit) => {
    calls.push({ path, init });
    return { community: null, tiers: null, tournaments: null };
  }) as ApiRequest;
  assert.deepEqual(await createWorksApi(request).fetchWorkStats("a/b"), { community: null, tiers: null, tournaments: null });
  assert.deepEqual(calls, [{ path: "/works/a%2Fb/stats", init: { auth: "optional" } }]);
});
```

`bookScreen.test.ts`: replace the "meta line drops what is missing…" test and delete the "rating counts are abbreviated without Intl compact notation" test (the count formatting now lives only in `bookStats.ts`, which has its own boundary tests) with:
```ts
test("meta line is year and pages, dropping what is missing", () => {
  assert.equal(bookMetaLine({ year: 1965, pages: 412 }), "1965 · 412 pages");
  assert.equal(bookMetaLine({ year: null, pages: 90 }), "90 pages");
  assert.equal(bookMetaLine({ year: 1965, pages: null }), "1965");
  assert.equal(bookMetaLine({ year: null, pages: null }), null);
});
```
If another test in the file asserts a `meta` string containing `★`, update it to the year/pages form.

- [ ] **Step 2: Run, expect FAIL** — `cd packages/shared && node --import tsx --test src/works/api.test.ts src/works/bookScreen.test.ts`.

- [ ] **Step 3: Implement**

`api.ts`:
```ts
import { apiPath } from "../api/path.js";
import type { ApiRequest } from "../api/port.js";
import type { BookStats } from "./bookStats.js";
import type { WorkPage } from "./types.js";

export function createWorksApi(request: ApiRequest) {
  return {
    fetchWork(id: string): Promise<WorkPage> {
      return request<WorkPage>(apiPath`/works/${id}`, { auth: "optional" });
    },
    fetchWorkStats(id: string): Promise<BookStats> {
      return request<BookStats>(apiPath`/works/${id}/stats`, { auth: "optional" });
    },
  };
}
```

`bookScreen.ts`: delete `COMPACT_UNITS` and `compactCount`, and make
```ts
export function bookMetaLine(work: Pick<WorkPage["work"], "year" | "pages">): string | null {
  const parts = [
    typeof work.year === "number" ? String(work.year) : null,
    typeof work.pages === "number" ? `${work.pages} pages` : null
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}
```

`frontend/scripts/test-work-page.mts:48`: `assert.ok(html.includes("1965 · 412 pages"));` and add `assert.ok(!html.includes("★ 4.3 · 2.3K ratings"));` on the next line.

- [ ] **Step 4: Run, expect PASS** — `cd packages/shared && node --import tsx --test src/works/api.test.ts src/works/bookScreen.test.ts && npm run typecheck && npm test && npm run build`, then `cd ../../frontend && npx tsx --tsconfig tsconfig.app.json --test scripts/test-work-page.mts`, then `cd ../mobile && npm run typecheck`.

- [ ] **Step 5: Commit**
```bash
git add packages/shared/src/works frontend/scripts/test-work-page.mts && git commit -m "Add fetchWorkStats and drop the Open Library rating from the book meta line" -m "The stats strip shows the rating now; keeping it in the meta line too would print it twice." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Web — stats strip and Stats page

**Files:**
- Modify: `frontend/src/api/works.ts`
- Create: `frontend/src/hooks/useWorkStats.ts`
- Create: `frontend/src/components/book/BookStats.tsx`
- Modify: `frontend/src/components/book/BookScreen.tsx` (hero, ~L169-178)
- Create: `frontend/src/pages/WorkStatsPage.tsx`
- Modify: `frontend/src/App.tsx` (public block, next to `/work/:id` at ~L55)
- Create: `frontend/scripts/test-book-stats.mts`

**Interfaces:**
- Consumes: `fetchWorkStats`, `bookStatsModel`, `BookStats`, `BookStatsModel` (Task 1 / PR #221).
- Produces: `useWorkStats(id: string | undefined)` → the react-query result; `StatsStrip({ cells, to }: { cells: BookStatsModel["strip"]; to: string })`; `StatsSections({ model }: { model: BookStatsModel })`.

- [ ] **Step 1: Failing render tests** — `frontend/scripts/test-book-stats.mts` (same render harness style as `scripts/test-work-page.mts`):
```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { bookStatsModel, type BookStats } from "@scripta/shared";
import { StatsSections, StatsStrip } from "../src/components/book/BookStats";

const full: BookStats = {
  community: { average: 3.8, count: 12, distribution: [1, 0, 2, 6, 3] },
  tiers: { score: 0.31, letter: "B", lists: 4, ballots: 23 },
  tournaments: { entered: 3, titles: 1, wins: 7, losses: 2, best: { round: 3, duels: 1 } }
};
const rating = { value: 4.12, count: 2310 };
const strip = (stats: BookStats | null, ol: typeof rating | null) =>
  renderToString(createElement(MemoryRouter, null, createElement(StatsStrip, { cells: bookStatsModel(stats, ol).strip, to: "/work/w/stats" })));
const sections = (stats: BookStats | null, ol: typeof rating | null) => renderToString(createElement(StatsSections, { model: bookStatsModel(stats, ol) }));

test("the strip links to the stats page and shows each cell", () => {
  const html = strip(full, rating);
  assert.ok(html.includes('href="/work/w/stats"'));
  for (const text of ["★ 4.1", "Open Library", "Loved it", "12 readers", "B tier", "4 lists", "1 title", "3 tournaments"]) assert.ok(html.includes(text), text);
});

test("while stats load or fail, the strip shows only Open Library", () => {
  const html = strip(null, rating);
  assert.ok(html.includes("★ 4.1"));
  assert.ok(!html.includes("readers"));
});

test("with nothing to show, the strip renders nothing", () => {
  assert.equal(strip(null, null), "");
  assert.equal(strip({ community: null, tiers: null, tournaments: null }, null), "");
});

test("the stats sections show feelings with bars, the tier letter and the tournament record", () => {
  const html = sections(full, rating);
  for (const text of ["Ratings", "★ 4.1 · 2.3K ratings on Open Library", "Loved it", "3.8 average · 12 ratings", "All-time", "Not for me", "Tier lists", "Average across 4 published tier lists · 23 votes", "Tournaments", "Won–lost", "7–2", "Winner"]) assert.ok(html.includes(text), text);
  assert.ok(html.includes("width:50%"));
  assert.ok(html.includes("width:100%"));
});

test("empty sections say why", () => {
  const html = sections({ community: null, tiers: null, tournaments: null }, null);
  for (const text of ["Shown once 3 readers have rated it.", "Shown once 3 people have voted on it in tier lists.", "Not in any tournament yet."]) assert.ok(html.includes(text), text);
});
```
Run: `cd frontend && npx tsx --tsconfig tsconfig.app.json --test scripts/test-book-stats.mts` → FAIL (module not found).

- [ ] **Step 2: API + hook**

`frontend/src/api/works.ts`: `export const { fetchWork, fetchWorkStats } = createWorksApi(request);`

`frontend/src/hooks/useWorkStats.ts`:
```ts
import { useQuery } from "@tanstack/react-query";
import { fetchWorkStats } from "../api/works";

export function useWorkStats(id: string | undefined) {
  return useQuery({ queryKey: ["works", id, "stats"], queryFn: () => fetchWorkStats(id!), enabled: Boolean(id), retry: false });
}
```

- [ ] **Step 3: Components** — `frontend/src/components/book/BookStats.tsx`:
```tsx
import { Link } from "react-router-dom";
import type { BookStatsModel } from "@scripta/shared";

const sectionHeading = "mb-3 text-lg font-bold";
const dim = "text-sm text-(--color-text-dim)";

export function StatsStrip({ cells, to }: { cells: BookStatsModel["strip"]; to: string }) {
  if (cells.length === 0) return null;
  return (
    <Link to={to} aria-label="Book stats" className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-(--color-border) bg-(--color-surface) p-3 text-left hover:border-(--color-accent)">
      {cells.map((cell) => (
        <span key={cell.key} className="min-w-0">
          <span className="block truncate text-sm font-semibold">{cell.value}</span>
          <span className="block truncate text-xs text-(--color-text-dim)">{cell.label}</span>
        </span>
      ))}
    </Link>
  );
}

export function StatsSections({ model }: { model: BookStatsModel }) {
  const { ratings, tiers, tiersEmpty, tournaments, tournamentsEmpty } = model;
  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className={sectionHeading}>Ratings</h2>
        {ratings.openLibrary ? <p className={`${dim} mb-3`}>{ratings.openLibrary}</p> : null}
        {ratings.community ? (
          <>
            <p className="text-2xl font-bold">{ratings.community.feeling}</p>
            <p className={`${dim} mb-3`}>{ratings.community.summary}</p>
            <ul className="flex flex-col gap-2">
              {ratings.community.bars.map((bar) => (
                <li key={bar.label} className="flex items-center gap-3 text-sm">
                  <span className="w-24 shrink-0">{bar.label}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-(--color-border)">
                    <span className="block h-full bg-(--color-accent)" style={{ width: `${Math.round(bar.fraction * 100)}%` }} />
                  </span>
                  <span className="w-8 shrink-0 text-right text-(--color-text-dim)">{bar.count}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {ratings.empty ? <p className={dim}>{ratings.empty}</p> : null}
      </section>
      <section>
        <h2 className={sectionHeading}>Tier lists</h2>
        {tiers ? (
          <div className="flex items-center gap-4">
            <span className="text-4xl font-bold">{tiers.letter}</span>
            <p className={dim}>{tiers.summary}</p>
          </div>
        ) : (
          <p className={dim}>{tiersEmpty}</p>
        )}
      </section>
      <section>
        <h2 className={sectionHeading}>Tournaments</h2>
        {tournaments ? (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {tournaments.map((cell) => (
              <div key={cell.label} className="rounded-xl border border-(--color-border) bg-(--color-surface) p-3">
                <dt className="text-xs text-(--color-text-dim)">{cell.label}</dt>
                <dd className="text-lg font-semibold">{cell.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className={dim}>{tournamentsEmpty}</p>
        )}
      </section>
    </div>
  );
}
```
If React's server render writes the width style as `width:50%` with different spacing, adjust the two `width:` assertions in the test to what `renderToString` actually emits (check once, then keep).

- [ ] **Step 4: Strip on the book screen** — in `BookScreen.tsx`: import `bookStatsModel` from `@scripta/shared`, `useWorkStats` and `StatsStrip`; near the other hooks:
```ts
const statsQuery = useWorkStats(page?.work.id);
const statsStrip = bookStatsModel(statsQuery.data ?? null, page?.work.rating ?? null).strip;
```
and render `{page ? <StatsStrip cells={statsStrip} to={`/work/${page.work.id}/stats`} /> : null}` right after the genre chips `ul` and before the meta line `p`.

Add to `scripts/test-work-page.mts`:
```ts
test("the hero carries a stats strip with the Open Library rating that links to the stats page", () => {
  const html = render({});
  assert.ok(html.includes('href="/work/w/stats"'));
  assert.ok(html.includes("★ 4.3"));
});

test("a library-only book has no stats strip", () => {
  assert.ok(!render({ page: null, book: owned, onShare: null }).includes("/stats"));
});
```
(The server render never resolves the stats query, which is exactly the loading/failed state: only the Open Library cell.)

- [ ] **Step 5: Stats page** — `frontend/src/pages/WorkStatsPage.tsx`:
```tsx
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { bookStatsModel } from "@scripta/shared";
import { useAuth } from "../auth/AuthContext";
import { EmptyState } from "../components/EmptyState";
import { StatsSections } from "../components/book/BookStats";
import { BackLink } from "../components/work/BackLink";
import { useWork } from "../hooks/useWork";
import { useWorkStats } from "../hooks/useWorkStats";

const shell = "mx-auto max-w-3xl px-5 py-8";

export function WorkStatsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { session } = useAuth();
  const work = useWork(id);
  const stats = useWorkStats(work.page?.work.id === id ? id : undefined);

  useEffect(() => {
    if (work.page && id && work.page.work.id !== id) navigate(`/work/${work.page.work.id}/stats`, { replace: true });
  }, [work.page, id, navigate]);

  const hasHistory = (window.history.state?.idx ?? 0) > 0;
  const back = <BackLink backTo={id ? `/work/${id}` : session ? "/dashboard" : "/"} onBack={hasHistory ? () => navigate(-1) : null} />;
  const retry = (onRetry: () => void) => (
    <EmptyState
      title="Couldn't load these stats."
      action={<button type="button" onClick={onRetry} className="rounded-lg border border-(--color-border) px-3 py-1.5 text-sm hover:border-(--color-accent)">Retry</button>}
    />
  );

  if (!work.page && work.isNotFound) return <main className={shell}>{back}<p className="text-sm text-(--color-text-dim)">No book with that id.</p></main>;
  if (!work.page && !work.isLoading) return <main className={shell}>{back}{retry(() => void work.refetch())}</main>;
  if (!work.page || work.page.work.id !== id || stats.isPending) return <main className={shell}>{back}<p className="text-sm text-(--color-text-dim)">Loading…</p></main>;
  if (stats.isError) return <main className={shell}>{back}{retry(() => void stats.refetch())}</main>;

  return (
    <main className={shell}>
      {back}
      <h1 className="mb-6 text-2xl font-bold">{work.page.work.title}</h1>
      <StatsSections model={bookStatsModel(stats.data ?? null, work.page.work.rating)} />
    </main>
  );
}
```
`App.tsx`: import it and add `<Route path="/work/:id/stats" element={<WorkStatsPage />} />` directly after the `/work/:id` route in the public block.

- [ ] **Step 6: Verify** — `cd frontend && npx tsx --tsconfig tsconfig.app.json --test scripts/test-book-stats.mts scripts/test-work-page.mts && npm run typecheck && npm run lint && npm test`. Browser check (dev stack per `docs/dev-workflow.md`; claim a slot, release it after): a fixture book page shows the strip under the genres and the meta line without the rating; tapping it opens `/work/<id>/stats`; signed out the same URL renders; 390px and 1280px widths; `/work/<id>/stats` for a book with no stats shows the three empty lines.

- [ ] **Step 7: Commit**
```bash
git add frontend && git commit -m "Show book stats on the web book screen and a stats page" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Mobile — stats strip and Stats screen

**Files:**
- Modify: `mobile/src/features/works/api.ts`
- Modify: `mobile/src/features/works/workPath.ts`, `mobile/src/features/works/workPath.test.ts`
- Create: `mobile/src/features/works/BookStats.tsx`
- Create: `mobile/src/features/works/WorkStatsScreen.tsx`
- Modify: `mobile/src/features/works/BookScreen.tsx` (hero ~L98-107, imports)
- Move: `mobile/src/app/(app)/(home,arena,library)/work/[id].tsx` → `mobile/src/app/(app)/(home,arena,library)/work/[id]/index.tsx`
- Create: `mobile/src/app/(app)/(home,arena,library)/work/[id]/stats.tsx`
- Move: `mobile/src/app/(public)/work/[id].tsx` → `mobile/src/app/(public)/work/[id]/index.tsx`
- Create: `mobile/src/app/(public)/work/[id]/stats.tsx`

**Interfaces:**
- Consumes: `fetchWorkStats`, `bookStatsModel`, `BookStatsModel`.
- Produces: `workStatsPath(id: string, segments: readonly string[]): string`; `StatsStrip({ cells, onPress })`; `StatsSections({ model })`; `WorkStatsScreen({ id })`.

- [ ] **Step 1: Failing path test** — `workPath.test.ts`, import `workStatsPath` and append:
```ts
test("the stats page opens in the same stack as the book it belongs to", () => {
  assert.equal(workStatsPath("w1", ["(app)", "(arena)", "work", "[id]"]), "/work/w1/stats");
  assert.equal(workStatsPath("w1", ["(public)", "work", "[id]"]), "/(public)/work/w1/stats");
});
```
Run `cd mobile && node --import tsx --test src/features/works/workPath.test.ts` → FAIL.

- [ ] **Step 2: Path + API**

`workPath.ts`:
```ts
export function workStatsPath(id: string, segments: readonly string[]): string {
  return `${workPath(id, segments)}/stats`;
}
```
`api.ts`: `export const { fetchWork, fetchWorkStats } = createWorksApi(request);`
Run the path test → PASS.

- [ ] **Step 3: Components** — `mobile/src/features/works/BookStats.tsx`:
```tsx
import { Pressable, StyleSheet, View } from "react-native";
import type { BookStatsModel } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { dynamicType, radii, spacing, typography, useTheme } from "../../ui";

export function StatsStrip({ cells, onPress }: { cells: BookStatsModel["strip"]; onPress: () => void }) {
  const { colors } = useTheme();
  if (cells.length === 0) return null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Book stats: ${cells.map((cell) => `${cell.value}, ${cell.label}`).join("; ")}`} onPress={onPress} style={[styles.strip, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      {cells.map((cell) => (
        <View key={cell.key} style={styles.cell}>
          <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{cell.value}</Text>
          <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{cell.label}</Text>
        </View>
      ))}
    </Pressable>
  );
}

export function StatsSections({ model }: { model: BookStatsModel }) {
  const { colors } = useTheme();
  const { ratings, tiers, tiersEmpty, tournaments, tournamentsEmpty } = model;
  const heading = (title: string) => <Text accessibilityRole="header" {...dynamicType} style={[typography.title, { color: colors.text }]}>{title}</Text>;
  const dim = (text: string) => <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{text}</Text>;
  return (
    <View style={styles.sections}>
      <View style={styles.section}>
        {heading("Ratings")}
        {ratings.openLibrary ? dim(ratings.openLibrary) : null}
        {ratings.community ? (
          <>
            <Text {...dynamicType} style={[typography.heading, { color: colors.text }]}>{ratings.community.feeling}</Text>
            {dim(ratings.community.summary)}
            {ratings.community.bars.map((bar) => (
              <View key={bar.label} style={styles.barRow}>
                <Text numberOfLines={1} {...dynamicType} style={[typography.caption, styles.barLabel, { color: colors.text }]}>{bar.label}</Text>
                <View style={[styles.barTrack, { backgroundColor: colors.border }]}>
                  <View style={{ width: `${Math.round(bar.fraction * 100)}%`, backgroundColor: colors.accent }} />
                </View>
                <Text {...dynamicType} style={[typography.caption, styles.barCount, { color: colors.textDim }]}>{bar.count}</Text>
              </View>
            ))}
          </>
        ) : null}
        {ratings.empty ? dim(ratings.empty) : null}
      </View>
      <View style={styles.section}>
        {heading("Tier lists")}
        {tiers ? (
          <View style={styles.tierRow}>
            <Text {...dynamicType} style={[typography.heading, styles.strong, { color: colors.text }]}>{tiers.letter}</Text>
            <View style={styles.flex}>{dim(tiers.summary)}</View>
          </View>
        ) : dim(tiersEmpty ?? "")}
      </View>
      <View style={styles.section}>
        {heading("Tournaments")}
        {tournaments ? (
          <View style={styles.grid}>
            {tournaments.map((cell) => (
              <View key={cell.label} style={[styles.gridCell, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{cell.label}</Text>
                <Text {...dynamicType} style={[typography.title, { color: colors.text }]}>{cell.value}</Text>
              </View>
            ))}
          </View>
        ) : dim(tournamentsEmpty ?? "")}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { alignSelf: "stretch", flexDirection: "row", flexWrap: "wrap", rowGap: spacing.sm, borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, marginTop: spacing.sm },
  cell: { width: "50%", paddingRight: spacing.sm },
  strong: { fontWeight: "700" },
  sections: { gap: spacing.xxl },
  section: { gap: spacing.sm },
  barRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 28 },
  barLabel: { width: 84 },
  barTrack: { flex: 1, height: 8, flexDirection: "row", borderRadius: radii.full, overflow: "hidden" },
  barCount: { width: 32, textAlign: "right" },
  tierRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  flex: { flex: 1 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  gridCell: { width: "48%", borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, gap: spacing.xs },
});
```
Mind the repo's Android one-line `Text` under-measure issue (memory note): the cell texts carry `numberOfLines={1}` already; if a bar label clips on device, give it `flexShrink: 0`.

- [ ] **Step 4: Strip on the book screen** — `BookScreen.tsx`: import `useQuery` from `@tanstack/react-query`, `bookStatsModel` from `@scripta/shared`, `fetchWorkStats` from `./api`, `workStatsPath` from `./workPath`, `StatsStrip` from `./BookStats`; in the component body (it already has or can call `useSegments()`):
```ts
const workId = page?.work.id;
const statsQuery = useQuery({ queryKey: ["works", workId, "stats"], queryFn: () => fetchWorkStats(workId!), enabled: Boolean(workId), retry: false });
const statsStrip = bookStatsModel(statsQuery.data ?? null, page?.work.rating ?? null).strip;
```
and render `{page ? <StatsStrip cells={statsStrip} onPress={() => router.push(workStatsPath(page.work.id, segments) as never)} /> : null}` after the genre chips view and before the meta line text, inside the hero.

- [ ] **Step 5: Stats screen** — `WorkStatsScreen.tsx`:
```tsx
import { useEffect } from "react";
import { router, Stack, useSegments } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ScrollView, StyleSheet } from "react-native";
import { bookStatsModel } from "@scripta/shared";
import { isPermanentError } from "../../core/apiClient";
import { ErrorState, Screen, Skeleton, spacing } from "../../ui";
import { fetchWork, fetchWorkStats } from "./api";
import { StatsSections } from "./BookStats";
import { workStatsPath } from "./workPath";

export function WorkStatsScreen({ id }: { id: string }) {
  const segments = useSegments();
  const work = useQuery({ queryKey: ["works", id], queryFn: () => fetchWork(id), retry: false });
  const canonicalId = work.data?.work.id;
  const stats = useQuery({ queryKey: ["works", id, "stats"], queryFn: () => fetchWorkStats(id), enabled: canonicalId === id, retry: false });

  useEffect(() => {
    if (canonicalId && canonicalId !== id) router.replace(workStatsPath(canonicalId, segments) as never);
  }, [canonicalId, id, segments]);

  const untitled = <Stack.Screen options={{ headerShown: true, title: "Stats" }} />;
  const failed = work.isError ? work : stats.isError ? stats : null;
  if (failed) {
    const permanent = isPermanentError(failed.error);
    return (
      <Screen bottom top={false} style={styles.centered}>
        {untitled}
        <ErrorState
          title="Stats unavailable"
          body={failed.error instanceof Error ? failed.error.message : "Couldn't load these stats."}
          actionLabel={permanent ? "Back" : "Retry"}
          onAction={permanent ? () => (router.canGoBack() ? router.back() : router.replace("/")) : () => void failed.refetch()}
        />
      </Screen>
    );
  }
  if (!work.data || canonicalId !== id || !stats.data) return <Screen bottom top={false} style={styles.centered}>{untitled}<Skeleton height={160} /></Screen>;

  return (
    <Screen bottom top={false}>
      <Stack.Screen options={{ headerShown: true, title: work.data.work.title }} />
      <ScrollView contentContainerStyle={styles.content}>
        <StatsSections model={bookStatsModel(stats.data, work.data.work.rating)} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { padding: spacing.lg, gap: spacing.md },
  content: { padding: spacing.lg, paddingBottom: spacing.huge },
});
```

- [ ] **Step 6: Routes**
```bash
git mv "mobile/src/app/(app)/(home,arena,library)/work/[id].tsx" "mobile/src/app/(app)/(home,arena,library)/work/[id]/index.tsx"
git mv "mobile/src/app/(public)/work/[id].tsx" "mobile/src/app/(public)/work/[id]/index.tsx"
```
(`git mv` into a not-yet-existing directory needs `mkdir -p` of the target directory first.) Fix the moved files' relative imports if any (`(app)` one uses `@/` aliases; the `(public)` re-export becomes `export { default } from "../../../(app)/(home,arena,library)/work/[id]/index";`). Create `(app)/(home,arena,library)/work/[id]/stats.tsx`:
```tsx
import { useLocalSearchParams } from "expo-router";
import { WorkStatsScreen } from "@/features/works/WorkStatsScreen";

export default function WorkStatsRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <WorkStatsScreen key={id} id={id} />;
}
```
and `(public)/work/[id]/stats.tsx`: `export { default } from "../../../(app)/(home,arena,library)/work/[id]/stats";`. Search for any reference to the route name `work/[id]` (`rg -n "work/\[id\]" mobile/src`) — a `Stack.Screen name="work/[id]"` would need to become `work/[id]/index`; the exploration found none.

- [ ] **Step 7: Verify** — `cd mobile && node --import tsx --test src/features/works/workPath.test.ts && npm run typecheck && npm test`.

- [ ] **Step 8: Commit**
```bash
git add -A mobile/src && git commit -m "Show book stats on the mobile book screen and a stats screen" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 9: Device pass** — after `node scripts/dev-status.mjs --json` shows the emulator free, dispatch `device-checker`: a fixture book from Library shows the strip under the genres (Open Library cell at least) and the meta line without the rating; tapping the strip opens the Stats screen with the book title in the header and three sections; back returns to the book; a book opened from the Arena tab opens Stats inside the Arena stack; a book with no Open Library rating and no stats shows no strip; Android text in strip cells and bar labels doesn't clip. Fix findings before merge.

---

## Self-review notes

- Spec coverage: strip (Tasks 2, 3), meta line keeps year/pages (1), own stats query and no waiting (2, 3), Stats page sections/bars/empty lines (2, 3), public routes (2: public block; 3: `(public)` group), loading/error/retry (2, 3), stats failure → only OL cell (2 test, 3 by construction), device pass (3).
- Names used across tasks: `fetchWorkStats`, `bookMetaLine` (year/pages), `useWorkStats`, `StatsStrip`, `StatsSections`, `WorkStatsPage`, `workStatsPath`, `WorkStatsScreen`.
