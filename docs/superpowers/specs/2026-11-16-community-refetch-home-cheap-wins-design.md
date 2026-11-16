# Community refetch lists, Home picks and cheap wins

From the 2026-11-16 architecture review: candidate 6, candidate 7 and the cheap wins.

## Refetch after follow and shelf publish

Today:

- **Web follow.** Every web follow goes through `invalidateAfterFollow` (`frontend/src/hooks/useCommunity.ts:6-10`), which invalidates `["community","people"]` and `["community","dashboard","circle"]`.
- **Mobile follow.** Mobile follows invalidate `["community","people"]` only:
  - `mobile/src/features/community/useFollowToggle.ts:18-22`;
  - `ProfileScreen.tsx:90-92`;
  - `mobile/src/features/home/FeedRow.tsx:48-54`, which also calls the `refetch` it is handed.

  Mobile's circle feed key is `["community","dashboard"]` (`FeedRow.tsx:8-17`), and its activity feed is nested under it as `["community","dashboard","activity"]`. So after a follow from a profile or the people list, the mobile circle feed stays stale.
- **Shelf publish.** Both clients invalidate own-profile, `["community","profile",username]` and `["community","activity",username]` on success (`frontend/src/components/OwnShelfView.tsx:84-86`, `mobile/src/features/community/MyShelfScreen.tsx:109-111`). On failure, mobile also invalidates own-profile and `["murals"]` (:115-116). Web does neither.

### Decision

New file `packages/shared/src/community/queryKeys.ts`, exported from `community/index.ts`:

- `AFTER_FOLLOW = [["community","people"], ["community","dashboard"]] as const`. The prefix `["community","dashboard"]` covers web's circle and activity feeds and mobile's dashboard and activity feeds.
- `afterShelfPublish(username: string | null)` returns `[["community","own-profile"], ["community","profile",username], ["community","activity",username]]`. The last two are included only when `username` is set.
- `AFTER_SHELF_PUBLISH_FAILED = [["community","own-profile"], ["murals"]] as const`.

Each client loops `queryClient.invalidateQueries({ queryKey })` over the list:

- Web `invalidateAfterFollow` uses `AFTER_FOLLOW`. `ForYouPanel.tsx:103-104` drops its `feed.refetch()` after it, since the prefix already refetches the activity feed.
- Mobile `useFollowToggle`, `ProfileScreen` and `FeedRow`'s `useFollowBack` use `AFTER_FOLLOW`. `useFollowBack` drops its `refetch` parameter, since invalidating the dashboard prefix refetches the active feed.
- Both shelf screens use the publish lists. Web gains the failure invalidation.

## Home picks

Decided with the user:

- Mobile Home stops listing the viewer's own games, and stays newest-first. This keeps the 2026-11-15 cover-story design.
- Both clients pick reading books with one rule: most recently read first. Mobile shows one; web shows five.

Today `mobile/src/features/home/homeModel.ts:17` `newGameRows` takes `items.slice(0, 2)` of `fetchDiscover("all","",0)`. That is up to 20 items (`HomeNewGames.tsx:20`). Web `HomePage.tsx:47-48` keeps library order; mobile `currentRead` (`homeModel.ts:11-15`) sorts by `parseBookDate(DateLastRead)`, newest first, with unparseable dates last and ties keeping library order.

### Decision

- `packages/shared/src/community/homeModel.ts` gains `readingNow(books: LibraryBook[] | undefined): LibraryBook[]`. It is mobile's `currentRead` sort, returning every `ReadStatus === 1` book. Mobile's `currentRead` becomes `readingNow(books)[0] ?? null`. Web `HomePage` passes `readingNow(books)` to `ReadingStrip`, which still shows 5 and counts all of them. The `currentRead` ordering tests move to shared.
- `newGameRows(items, locale, viewerId: string | null)` drops items whose `author.userId === viewerId` before taking 2. `HomeNewGames` passes `useAuth().user?.id ?? null`.

## Cheap wins

- **Community jobs.**
  - Today `backend/src/modules/community/plugin.ts:42-66` runs the event archive and the recap freeze at t=0 on raw `setInterval`. This is the boot stall the startup stagger removed everywhere else.
  - Both move to `createJobs(app.log)`:
    - `jobs.every("community event archive", ARCHIVE_INTERVAL_MS, archive, 100_000)`;
    - `jobs.every("top shelf recap freeze", RECAP_INTERVAL_MS, freezeRecaps, 110_000)`.

    Those slots are free next to books' `FIRST_RUN_DELAY_MS`.
  - `onClose` calls `jobs.stopAll()`. `createJobs` logs failures as `${name} failed`, so the two failure messages stay `"community event archive failed"` and `"top shelf recap freeze failed"`.
  - The success log `"moved old community events to history"` stays in `archive`. The tests in `community/archive.test.ts` (:126, :148, :170, :181) change from "runs at registration" to "runs after the first-run delay". They mock `setTimeout` as well as `setInterval`.
- **Locale store.**
  - `frontend/src/i18n/locale.ts` and `mobile/src/i18n/locale.ts` are byte-identical. They differ only through `./flag`: `import.meta.env?.DEV !== false` on web, `__DEV__` on mobile.
  - `packages/shared/src/i18n/localeStore.ts` exports `createLocaleStore(portugueseEnabled: boolean)`, returning `getLocalePreference`, `setLocalePreference`, `setDeviceLocaleTags`, `subscribeLocale` and `getLocale`. It is exported from `i18n/index.ts`.
  - Each client's `locale.ts` becomes `export const { … } = createLocaleStore(PORTUGUESE_ENABLED)`, so its importers don't change.
- **Murals import.** In `backend/src/modules/community/service.ts:7`, change the import to `import type { MuralsPublicApi } from "../murals/index.js"`.
- **Username rule.**
  - `packages/shared/src/auth.ts` exports `isValidUsername(username: string): boolean` (`/^[a-zA-Z0-9_.]{3,30}$/` on the trimmed value). `authFieldErrors` uses it.
  - `mobile/src/features/you/ProfileHeader.tsx:85` and `mobile/src/app/choose-username.tsx:39,71,75` disable Save / Continue with `!isValidUsername(...)` instead of `length < 3`.

## Not in scope

- Aligning web's circle key `["community","dashboard","circle"]` with mobile's `["community","dashboard"]`. The shared prefix covers both.
- Web Home's followed and popular tiers, and a popularity ranking on mobile.
- Web's HTML `pattern` attributes for usernames.
