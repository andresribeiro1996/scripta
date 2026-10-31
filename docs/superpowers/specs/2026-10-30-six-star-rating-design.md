# Six-star personal rating

Date: 2026-10-30. Scope: phone app, website, shared package, backend. Follows the mobile book page redesign (`2026-10-30-mobile-book-page-design.md`), which ships first with today's feeling chips in its status sheet.

## Why

Today a reader rates a finished book with five words — Not for me, Fine, Good, Loved it, All-time (`FINISH_FEELINGS`, `packages/shared/src/library/finish.ts`), stored as `Rating` 1–5. The user wants to rate with stars instead, and wants one rung above five: a **sixth, special star** for the books that are truly all-time favourites, with its own colour and effect, visible in their library and on their profile.

## Goals

- Rating is a row of six stars wherever a reader rates a book today.
- Stars 1–5 are the app's gold accent. Star 6 is the **spectrum star**: colours slowly flow through it (gold → rose → violet → teal → gold, continuous loop); picking it plays a short pop (scale overshoot) and a burst of small sparks. Reference: option D in the "sixth_star_effect_options" mockup shown in chat.
- A book rated 6 shows the spectrum star on the reader's public profile, and — unless the reader turns it off — on its tile in their own library grid.

## Non-goals

- No change to the external rating ("★ 4.3 · 505 ratings"), which stays out of 5.
- No half stars.
- No automatic upgrades: nothing becomes a 6 except by the reader choosing it.

## Anti-goals

- Any migration or import path that turns an existing 5 (including today's "All-time") into a 6. **Every existing rating and every Goodreads/Kobo import stays exactly 1–5.** The user was explicit: a 6 only ever comes from a manual change.
- The spectrum star appearing on a profile that isn't public, or exposing ratings 1–5 to anyone.

## Data

- `Rating` gains the value 6. Valid personal ratings become integers 1–6. Everywhere that validates 1–5 accepts 6 — at least `backend/src/modules/library/service.ts:135` and `backend/src/modules/library/workHolders.ts:41`; the builder finds the rest (`rg "Rating"` across backend, shared, frontend, mobile).
- Imports (Goodreads CSV `packages/shared/src/library/bookCsv.ts`, Kobo) are unchanged: they still produce 1–5.
- Goodreads CSV **export**, if one exists, writes 6 as 5 (Goodreads stops at five). Claude's call.

## Rating control

- Replaces the feeling chips everywhere they're used: `mobile/src/features/library/components/FeelingChips.tsx`, `frontend/src/components/FeelingChips.tsx`, the mobile finish screen, the web finish sheet, and the new mobile book page status sheet.
- Shown under the same condition as today: once the book is Finished. Claude's call.
- Tapping a star sets that rating. No clearing — today's chips can't clear a rating either, and clearing would need a new library change kind. Claude's call.
- The six stars must fit one row on a 360pt-wide phone with each star a ≥44pt touch target (hit slop allowed).
- The spectrum animation respects reduced motion: with reduce-motion on, the sixth star shows a static multi-colour fill and no burst.
- Accessibility: each star is a button labelled "Rate N stars" (star 6: "Rate 6 stars, all-time favourite"), selected state exposed.
- Where the old words were shown as a label (e.g. "Loved it ▾" on the book page badge, "How did it land?"), show the stars instead (e.g. small "★★★★☆☆"-style display, or "4★"). Builder's choice; the six-level meaning must be readable.

## The spectrum marker

- **Library grid** (mobile and web): a 6-rated book's tile carries a small spectrum star (corner of the tile, not covering the title). Only 6 gets a marker; 1–5 add nothing to the grid.
- **Profile** (the user's rule): a 6-rated book carries the same small spectrum star wherever the reader's books appear on their profile — for visitors **whenever the profile is public** (same visibility rules that already decide who sees the profile's books, `backend/src/modules/community/domain/visibility.ts`), and on the reader's own view of it. Ratings are private today: the public book shape (`backend/src/modules/library/publicResolver.ts`) carries no rating, so add only a boolean such as `allTime` (true when Rating is 6) — never the rating value — and only on public responses. No new profile section is required.
- The marker animates gently (same flowing colours) or is static at small sizes — builder's call based on performance in a grid of many tiles; a grid of 50 animated markers must not drop frames on Android.

## The setting

- One account-level switch, **"Show all-time stars in my library"**, default **on**, stored server-side so the phone and the website agree.
- It governs **only the reader's own library grid**. The profile follows the profile's public/private visibility, not this switch (the user's rule).
- Off: no spectrum marker on library tiles. The rating itself is untouched, and the rating control still shows six stars with the sixth selected.
- Lives with the reader's other account settings on both clients (builder finds the existing place).

## Knock-on uses of Rating

- "All-time favourites" mural preset (`packages/shared/src/murals/presets.ts:38`, today `Rating >= 4 && <= 5`): include 6, sorted first. Claude's call.
- Community stats count to 6 (the user's rule): `backend/src/modules/works/stats.ts`, `workHolders.communityRatings` and `packages/shared/src/works/bookStats.ts` move to six buckets (1★…6★, `distribution` becomes a 6-tuple) and an average on the 1–6 scale. Any average label that mapped back to a feeling word becomes a star figure (e.g. "4.6★").
- Top Shelf, recaps, quizzes or anything else reading `Rating`: builder audits; a check meaning "top-rated" becomes `>= 5` (so 6 is included), and any 1–5 range check accepts 6. List each decision in the plan.
- "No old words" is strict for rating controls and rating labels; names like the "All-time favourites" mural preset stay.
- `FINISH_FEELINGS` either becomes a six-entry star scale or is removed; no remaining UI should show the old words.

## Rollout

- `FinishRating` and `setRating` widen to 1–6; `setRating` gets a range check.
- Ship order: backend first (accepts and indexes 6), then web, then the mobile OTA. Until a phone has the update it can't pick 6, and it shows a 6 as its best fallback (5 / "All-time") without overwriting it.
- Builds on the mobile book page redesign: start this branch from main after that one merges, so the star control replaces the chips in its status sheet.

## Constraints

- Shared logic (valid range, star labels, marker visibility rule) lives in `@scripta/shared`; both clients use it.
- Backend tests cover 6 accepted, 7 and 0 rejected, imports never yielding 6.
- Tokens from `DESIGN.md`/`theme.tsx`; the spectrum colours are new and should be added as named tokens, not inline hex.
- Works in light and dark themes.

## Left to the builder

- Exact spectrum colours and timing, spark count and size.
- Where the setting sits in each client's settings.
- The compact star display used in labels.

## Claude's calls (for the user to check)

1. Rating stays available only once a book is Finished.
2. No clearing a rating (same as today).
3. Goodreads export writes 6 as 5.
4. "All-time favourites" mural includes 6-star books, first.
5. The library setting defaults to on.
6. Visitors learn only that a book is a 6 (a boolean), never your other ratings.
