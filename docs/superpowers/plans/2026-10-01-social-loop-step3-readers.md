# Social loop, step 3: finding readers: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three changes:
- People suggests readers, with a reason, instead of an empty search box.
- Publishing a profile no longer needs a mural.
- Publishing asks one clear question about who sees your reading.

**Architecture:**
- **Shared** gains `bookMatchKeys`, `suggestionReason` and two types.
- **The community backend** gains:
  - `GET /community/people/suggested`, computed per request over published
    profiles' public libraries against the viewer's own;
  - `PUT /community/profile/publish`, which now accepts
    `{ muralId?, shareReading? }`.
- **Both clients:**
  - show suggestions in People while the search is empty;
  - replace the "pick a mural to publish" step with one publish dialog. It
    asks the reading question and publishes with or without a shelf mural.

**Tech Stack:** Fastify and `node:sqlite` with `node:test`; `@scripta/shared`;
Expo Router, React Native and TanStack Query v5 on mobile; React, React
Router, TanStack Query and Tailwind v4 on web.

**Spec:** `docs/superpowers/specs/2026-09-30-social-loop-design.md`, section
"Step 3", including "Decided while planning step 3".

**Branch:** `claude/social-loop-step3-readers`, stacked on step 2's
`claude/social-loop-step2-feedback` (PR #94). The worktree is
`/Users/andreribeiro/Documents/scripta/.claude/worktrees/app-social-interaction-gaps-9f9c3c`.

## Global Constraints

**Code**
- No comments in new code. Minimum code. Reuse `@scripta/shared` for
  anything both clients need.
- Don't swallow errors, and don't weaken auth or validation.

**Privacy**
- Only published profiles are ever suggested.
- The viewer, and people they already follow, are excluded.
- Only public library data is compared (`resolveLibrary` returns the public
  projection).

**Copy**
- Publish dialog title: "Publish your shelf?"
- Question: "Share what you read and finish with followers?"
- Answer buttons: "Share my reading" and "Keep my reading private".
- Reasons: "You share N books", "You share 1 book", "Recently active".
- People's empty-search heading: "Readers you might like".

**Compatibility**
- The publish body's fields are both optional, so old clients that send
  `{ muralId }` keep working.

**Checks**
- Shared: build and tests.
- Backend: typecheck, and
  `DOTENV_CONFIG_PATH=/nonexistent/.env npm test --workspace backend`.
- Mobile: typecheck and tests.
- Web: typecheck, lint and tests.

**Git**
- Run `/usr/bin/git` from the worktree root as a plain command.
- Commit after checks pass, with a why-body and a `Co-Authored-By:` trailer.

**Baseline** (step 2 head `5b11b577`): shared 257, backend 534, mobile 145,
web 76.

## Review Focus

1. **Private users, yourself and people you already follow** never appear
   in suggestions. Pinned in Task 2.
2. **A book matches** when its ISBN key matches, or its title-and-author
   key matches, even when only one side has an ISBN. Pinned in Tasks 1 and 2.
3. **Publishing with no shelf mural** works, and the visitor profile
   renders the profile-only block. The backend part is pinned in Task 2; the
   render path already exists.
4. **The reading answer is written in the same request as the publish.**
   An old client that sends only `{ muralId }` leaves `reading` untouched.
   Pinned in Task 2.
5. **Dismissing the publish dialog publishes nothing.** Checked in the
   Task 3 and Task 4 reviews.

---

### Task 1: Shared matching, reasons and types

**Files:**
- Modify: `packages/shared/src/library/merge.ts`, adding `bookMatchKeys`
  next to `bookKey`
- Modify: `packages/shared/src/community/types.ts`, adding
  `SuggestedReader` and `PublishProfileInput`
- Modify: `packages/shared/src/community/helpers.ts`, adding
  `suggestionReason`
- Test: the files that already test `merge.ts` and the community helpers.
  Find them with `ls packages/shared/src/library/*.test.ts packages/shared/src/community/*.test.ts`.

**Interfaces (produces):**

```ts
export function bookMatchKeys(book: Record<string, unknown>): string[];
export interface SharedBook { title: string; author: string; coverUrl: string | null }
export interface SuggestedReader extends PersonResult { sharedCount: number; sharedBooks: SharedBook[] }
export interface PublishProfileInput { muralId?: string; shareReading?: boolean }
export function suggestionReason(reader: Pick<SuggestedReader, "sharedCount">): string;
```

- [ ] **Step 1: Write the failing tests.**
  - `bookMatchKeys({ ISBN: "978-0-00-000000-2", Title: " Dune ", Attribution: "Frank  Herbert" })`
    returns `["isbn:<normalized>", "ta:dune|frank herbert"]`, using the same
    normalization as `bookKey`.
  - Without an ISBN it returns only the `ta:` key.
  - `suggestionReason({ sharedCount: 6 })` is "You share 6 books",
    `({ sharedCount: 1 })` is "You share 1 book", and
    `({ sharedCount: 0 })` is "Recently active".

- [ ] **Step 2: Implement.**

  ```ts
  export function bookMatchKeys(book: Record<string, unknown>): string[] {
    const isbn = normalizeIsbn(book.ISBN);
    const title = normalizeForMatch(book.Title);
    const author = normalizeForMatch(book.Attribution);
    const keys = isbn ? [`isbn:${isbn}`] : [];
    if (title || author) keys.push(`ta:${title}|${author}`);
    return keys;
  }

  export function suggestionReason(reader: Pick<SuggestedReader, "sharedCount">): string {
    if (reader.sharedCount === 0) return "Recently active";
    return `You share ${reader.sharedCount} ${reader.sharedCount === 1 ? "book" : "books"}`;
  }
  ```

  Add the types to `community/types.ts`. Export `bookMatchKeys` wherever
  `bookKey` is exported from.

- [ ] **Step 3: Run the checks.** Shared build and tests: all pass.
- [ ] **Step 4: Commit.** Commit with the message "Match books across
  libraries by ISBN or title and author, and say why a reader is suggested".

---

### Task 2: Backend: publish without a mural, and suggested readers

**Files:**
- Modify: `backend/src/modules/community/domain/ports.ts`
- Modify: `backend/src/modules/community/adapters/sqlite/sqliteCommunityRepository.ts`
- Modify: `backend/src/modules/community/service.ts`
- Modify: `backend/src/modules/community/routes.ts`
- Test: `backend/src/modules/community/service.test.ts`
- Test: `backend/src/modules/community/routes.test.ts`
- Test: `backend/src/modules/community/adapters/sqlite/sqliteCommunityRepository.test.ts`

**Interfaces:**
- Consumes: `bookMatchKeys`, `SuggestedReader` and `PublishProfileInput`
  from Task 1.
- Produces:
  - `publishProfile(userId: string, input: PublishProfileInput): void`,
    which replaces `publishProfile(userId, muralId)`;
  - `suggestPeople(viewerId: string, limit: number): SuggestedReader[]`;
  - `repo.listPublishedProfiles(limit: number): ProfileRow[]`, newest
    `updated_at` first;
  - routes:
    - `PUT /community/profile/publish` takes the body
      `{ muralId?: string (min 1), shareReading?: boolean }`;
    - `GET /community/people/suggested?limit=` (authed; limit 1–50,
      default 20) returns `{ people: SuggestedReader[] }`.

- [ ] **Step 1: Write the failing tests.**
  - **Repository:** `listPublishedProfiles(2)` returns the two most
    recently updated published rows and skips unpublished ones.
  - **Service, publishing:**
    1. With no mural and no existing row, the row is published with
       `mural_id: null`, and no `mural_published` event is emitted.
    2. With no `muralId` but an existing owned shelf mural, publishing keeps
       that `mural_id`.
    3. With a `muralId` the user doesn't own, it still throws
       `MuralNotOwnedError`.
    4. `shareReading: true` sets `feedSettings.reading` to true, and
       `shareReading: false` sets it to false.
    5. With no `shareReading`, an existing `reading` value is unchanged.
    6. With no username, it still throws `UsernameRequiredError`.
  - **Service, suggestions** (use `libraries.set(userId, { books: [...] })`
    and published profile rows):
    7. The ranking follows the number of shared books.
    8. A book matches on ISBN even when the titles differ, and on title and
       author when one side has no ISBN.
    9. Unpublished users, the viewer and people the viewer follows never
       appear.
    10. When fewer than 5 readers overlap, the list is filled with recently
        active published readers, with `sharedCount: 0`, in `updated_at`
        order.
    11. `sharedBooks` holds at most 3 books, with `coverUrl` from the
        candidate's `_coverUrl`, or `null`.
    12. `limit` is respected.
  - **Routes:**
    - `PUT /community/profile/publish` with `{}` returns 200.
    - With `{ shareReading: "yes" }` it returns 400.
    - `GET /community/people/suggested` without auth returns 401.

  Run the files and see the new tests fail.

- [ ] **Step 2: Implement publishing.**
  - Route: `publishSchema = z.object({ muralId: z.string().min(1).optional(), shareReading: z.boolean().optional() })`.
    The 400 message becomes "Expected {muralId?, shareReading?}.".
  - Service:

    ```ts
    publishProfile(userId, input) {
      if (!deps.userHasUsername(userId)) throw new UsernameRequiredError();
      if (input.muralId !== undefined && !deps.murals.ownsMural(userId, input.muralId)) throw new MuralNotOwnedError();
      const existing = repo.getProfileRow(userId);
      const keptMural = existing?.mural_id && deps.murals.ownsMural(userId, existing.mural_id) ? existing.mural_id : null;
      const muralId = input.muralId ?? keptMural;
      const now = new Date().toISOString();
      repo.upsertProfile({ user_id: userId, published: 1, mural_id: muralId, published_at: existing?.published_at ?? now, updated_at: now, feed_settings: existing?.feed_settings ?? null });
      if (input.shareReading !== undefined) repo.updateFeedSettings(userId, { ...settingsFor(userId), reading: input.shareReading });
      if (muralId && (!existing?.published_at || existing.mural_id !== muralId)) emit(userId, "mural_published", "mural", muralId);
    },
    ```

  - Update the `CommunityService` interface. Grep for any other caller of
    `publishProfile(` in the backend and update it.

- [ ] **Step 3: Implement suggestions.**
  - Repository:
    `SELECT * FROM profiles WHERE published = 1 ORDER BY updated_at DESC LIMIT ?`,
    prepared once.
  - Service: add these constants (`SUGGESTION_SCAN_CAP = 500`,
    `SUGGESTION_OVERLAP_FLOOR = 5`, `SHARED_BOOKS_SHOWN = 3`) and this
    method:

    ```ts
    suggestPeople(viewerId, limit) {
      const own = new Set<string>();
      for (const book of libraryBooks(deps.resolveLibrary(viewerId))) for (const key of bookMatchKeys(book)) own.add(key);
      const candidates = repo.listPublishedProfiles(SUGGESTION_SCAN_CAP).map((row) => row.user_id).filter((id) => id !== viewerId && !repo.getFollow(viewerId, id));
      const profiles = deps.resolveProfiles(candidates);
      const scored = candidates.flatMap((id, recency) => {
        const user = profiles.get(id);
        if (!user) return [];
        const shared = libraryBooks(deps.resolveLibrary(id)).filter((book) => bookMatchKeys(book).some((key) => own.has(key)));
        return [{ id, user, recency, shared }];
      });
      const overlapping = scored.filter((entry) => entry.shared.length > 0).sort((a, b) => b.shared.length - a.shared.length || a.recency - b.recency);
      const fill = overlapping.length < SUGGESTION_OVERLAP_FLOOR ? scored.filter((entry) => entry.shared.length === 0) : [];
      const glyphOf = glyphLookup();
      return [...overlapping, ...fill].slice(0, limit).map((entry) => ({
        user: withGlyph(entry.user, entry.id, glyphOf),
        followerCount: repo.countFollowers(entry.id),
        viewerFollows: false,
        private: false,
        sharedCount: entry.shared.length,
        sharedBooks: entry.shared.slice(0, SHARED_BOOKS_SHOWN).map((book) => ({ title: String(book.Title ?? ""), author: String(book.Attribution ?? ""), coverUrl: typeof book._coverUrl === "string" ? book._coverUrl : null }))
      }));
    },
    ```

    `libraryBooks(doc)` is a small module-level helper. It returns
    `doc && Array.isArray(doc.books) ? doc.books.filter(isRecord) : []`;
    use an existing `isRecord` if the module has one, or else a one-line
    guard.

  - Route: `GET /community/people/suggested` (authed). Use a query schema
    of `{ limit: 1..50, default 20 }` and return
    `{ people: service.suggestPeople(request.user.id, limit) }`. Register
    it with the other authed routes.

- [ ] **Step 4: Run the checks.** Run the focused files, then backend
  typecheck and the full backend suite. Expected: all green.
- [ ] **Step 5: Commit.** Commit with the message "Publish a profile without
  a mural, answer the reading question in the same request, and suggest
  readers by books in common".

---

### Task 3: Mobile: suggestions in People, and one publish dialog

**Files:**
- Modify: `mobile/src/features/community/api.ts`. `publishProfile` takes a
  `PublishProfileInput`; add `fetchSuggestedPeople()`.
- Modify: `mobile/src/features/community/PeoplePane.tsx`
- Modify: `mobile/src/features/community/MyShelfScreen.tsx`

**Interfaces (consumes):**
- `SuggestedReader`, `suggestionReason` and `PublishProfileInput` from
  shared;
- `BookCover({ cover, title, width, height })` from
  `mobile/src/features/arena/BookCover.tsx`.

- [ ] **Step 1: API.** Change `publishProfile(input: PublishProfileInput)`
  so it sends `input` as the body. Add:

  ```ts
  export async function fetchSuggestedPeople() {
    return apiClient.request<{ people: SuggestedReader[] }>("/community/people/suggested", { auth: true });
  }
  ```

  Update every caller of `publishProfile`; `MyShelfScreen` is the only one.

- [ ] **Step 2: People.**
  - While the trimmed search is empty, `PeoplePane` queries
    `fetchSuggestedPeople` (`queryKey: ["community", "people", "suggested"]`)
    and lists the rows under a "Readers you might like" caption, instead of
    the "Find people" empty state.
  - Each suggestion uses the existing row layout (avatar, username and
    glyph, and the Follow button with the same toggle), plus:
    - a second line of `suggestionReason(reader)`;
    - up to three small `BookCover`s (width 24, height 36, overlapping by 6)
      when `sharedBooks` isn't empty.
  - Follow and unfollow invalidate `["community", "people"]`, as now, which
    covers the suggested key too.
  - **Empty or failed suggestions:**
    - If the list is empty, keep today's "Find people" empty state.
    - On error, show an `ErrorState` "Couldn't load suggestions." with
      Retry.
  - A non-empty search works exactly as today.

- [ ] **Step 3: One publish dialog.**
  - In `MyShelfScreen`, tapping the Private chip on an unpublished shelf
    opens a single dialog, whether or not a shelf mural exists. It replaces
    both the `confirmingPublish` dialog and the picker's "publish" mode.
    - Title: "Publish your shelf?"
    - Body: the existing
      "It becomes a public page at /u/<username>, and people can follow you."
      then "Share what you read and finish with followers?"
    - Two `Button`s: "Share my reading" and "Keep my reading private". Each
      runs
      `publishProfile({ ...(ownData.muralId ? { muralId: ownData.muralId } : {}), shareReading })`
      through the existing `run(...)`, then closes the dialog.
    - Closing the dialog publishes nothing.
  - The picker keeps only its "switch" mode, reached from the ⋯ menu's
    "Switch shelf mural…". Remove the dead publish branch and the
    `pickerMode` "publish" value.
  - Unpublish is unchanged.

- [ ] **Step 4: Run the checks.** Run mobile typecheck and tests. Expected:
  green, with 145 tests.
- [ ] **Step 5: Commit.** Commit with the message "Suggest readers in People,
  and publish your shelf with one question about your reading".

---

### Task 4: Web: suggestions in People, and one publish dialog

**Files:**
- Modify: `frontend/src/api/community.ts`. `publishProfile(input)`; add
  `fetchSuggestedPeople()`.
- Modify: `frontend/src/hooks/useCommunity.ts`, adding
  `useSuggestedPeople(enabled)`.
- Modify: `frontend/src/pages/PeoplePage.tsx`
- Modify: `frontend/src/components/OwnShelfView.tsx`

- [ ] **Step 1: API and hook.** They mirror mobile. `fetchSuggestedPeople`
  GETs `/community/people/suggested` and returns `people`.
  `useSuggestedPeople(enabled)` is a `useQuery` with the key
  `["community", "people", "suggested"]`.

- [ ] **Step 2: People.** When the search is empty, show "Readers you might
  like" and the suggestions in the existing row markup, with:
  - `suggestionReason(reader)` as a second line;
  - up to three small covers (`<img>` 24×36 when `coverUrl`, otherwise a
    `bg-(--color-border)` block), overlapping with `-space-x-1.5`;
  - the existing follow toggle.

  Empty suggestions fall back to today's "Find people." empty state. On
  error, show an `EmptyState` "Couldn't load suggestions." with the existing
  retry button.

- [ ] **Step 3: One publish dialog.** In `OwnShelfView`, "Publish…" no longer
  requires a shelf mural. Remove the `if (!muralId) return;` guard.
  - It opens a small dialog built from the existing dialog pattern in
    `ConfirmDialog.tsx` (read it; if `useConfirm` can't render two answer
    buttons, add a minimal local dialog component in `OwnShelfView.tsx`).
    Its content:
    - title "Publish your shelf?";
    - the existing body line, then
      "Share what you read and finish with followers?";
    - buttons "Share my reading" and "Keep my reading private", plus Cancel.
  - Each answer runs `publishProfile({ ...(muralId ? { muralId } : {}), shareReading })`
    through `run(...)`.
  - Cancel publishes nothing.

- [ ] **Step 4: Run the checks.** Run web typecheck, lint and tests (76).
  Then run every package's checks once.
- [ ] **Step 5: Commit.** Commit with the message "Suggest readers on web
  People, and publish your shelf with one question about your reading".

---

### Task 5: Device pass (mobile), short

Only if the emulator is free and the 1-minute load average is under about
40. The same rules as before apply:
- check the lease first;
- change state only through the UI, and undo any change;
- zoom into labels;
- about 10 minutes;
- run `npm run dev:release`.

Check:
1. **People with an empty search** shows "Readers you might like" with
   reasons, if the fixture has other published readers.
2. **The publish dialog.** On My shelf, if the dev account is published,
   unpublish it first through the UI. The Private chip then opens the dialog
   with the two answers.
   - Choosing "Keep my reading private" publishes; the chip reads
     Published.
   - Then restore the original state through the UI: unpublish again if it
     started unpublished.
3. **Closing the dialog without answering** leaves the shelf Private.

---

## After the tasks

1. Run the whole-branch review and every check.
2. Push, and open a PR stacked on #94, with its base set to
   `claude/social-loop-step2-feedback`.
