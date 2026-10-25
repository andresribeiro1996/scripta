# Beta sweep fixes

Fixes for all 21 findings of the 2026-10-25 beta sweep (`/Users/andreribeiro/Documents/scripta/beta-tests/2026-10-25-0053/report.md`, outside every worktree, screenshots beside it; it has each finding's repro steps), plus two console errors from the same run. The sweep ran the mobile app at 320×640dp; where the web app shares a defect, it is fixed in the same change. Finding numbers (#n) are the report's.

Paths are under `mobile/src/` unless they start with `app/` (mobile routes, also under `mobile/src/`), `frontend/`, `backend/`, `packages/` or `DESIGN.md`.

## Goals

- No silent data loss: leaving an editor with unsaved changes asks first.
- Every disabled control or dead end says why or offers the way out.
- Mobile matches DESIGN.md: 44pt targets, labelled editor Save, themed dialogs, sentence case, error replaces hint, the product named Atmyshelf.
- Quiz results name questions, books and players, and the player learns the right answers.

## Non-goals

- Undo for deletions, or any new navigation.
- A web router migration (see #1).
- Watertight quiz replay protection for guests (see #6).
- Web-only polish the sweep did not find. Web changes only where the same defect exists there (#6, #12, #19, plus web strings touched by #16/#17).

## Decisions

### Data loss and bugs

**#1 Unsaved editor changes.** The mural (`features/murals/MuralEditorScreen.tsx:122` `unsaved`), tier list (`features/tierlists/TierlistEditorScreen.tsx:119` `dirty`) and quiz (`features/quizzes/QuizEditorScreen.tsx:97` `dirty`) editors already track unsaved state and none guards leaving. Extract the `usePreventRemove` + confirm pattern from `features/quizzes/QuizPlayScreen.tsx:67-72` into one hook and use it in all three. Choices: "Discard" (destructive, leaves) and "Keep editing". The hook must run above each screen's early returns (`MuralEditorScreen.tsx:203-204`). The confirm uses the themed confirm dialog from #15. Web needs no guard: the web mural editor saves every change as it happens (`frontend/src/pages/MuralEditorPage.tsx` `saveBlocks` ~239-426, rename on blur ~481), so it has no unsaved state.

**#2 Tab bar keeps the old theme.** `app/(app)/_layout.tsx:28,45` builds `tabBarStyle` from `useTheme()` and looks reactive, so the cause is unknown. Reproduce on the emulator first (Settings → Appearance → Dark → Light; the bar stays dark until another screen opens), find the cause, then fix. Candidate fixes are in the recon: re-keying `<Tabs>` on the theme, or the native tab bar not re-reading `screenOptions` until a navigation event. A repro that fails to show the bug is reported, not papered over.

**#3 Username Cancel.** `features/settings/SettingsScreen.tsx:74`: Cancel also clears `error` and resets `draft` to the current username.

**#4 Reorder arrows.** Root cause in `packages/shared/src/library/libraryOrder.ts:128-146` (`reorderOnDrop` inserts ahead of the target's unit) combined with `ReorderList.tsx:62` targeting the adjacent *row*: a series row's neighbour is often the same unit (no-op), and "down" onto the immediate next unit is a no-op even for standalone books. The library always lists every series first, then standalone books (`buildUnits`, `libraryOrder.ts:53-85`), and that rule stays (user's decision). So arrows move a series only among series and a standalone book only among standalone books: up goes ahead of the previous unit of the same kind, down goes after the next unit of the same kind. An arrow with no same-kind unit to move past is disabled (the last series' down, the first standalone book's up). Series rows carry a short caption that series stay at the top and move together. Write a failing shared test first, asserting on `orderLibraryBooks` output rather than `_order`.

**#18 Mural header.** Render the `Stack.Screen` title options (`MuralEditorScreen.tsx:229-232`) on the loading and error branches too, so the header never shows `murals/[id]`.

**#20 Hint and error.** Shared `Input` (`ui/components.tsx:~383`) renders the hint only when there is no error. Fixes every form.

**#8 Save image error.** `features/sharing/ContentShareSheet.tsx:64`: a thrown `requestPermissionsAsync` shows the same friendly sentence as the not-granted case (line 65), never the native message. Catch that call specifically; other failures in `run()` keep their current handling.

**#12 Name lengths.** Cap at 200 characters, matching tournaments/tier lists/quizzes:
- Mobile `maxLength={200}` on mural rename (`MuralEditorScreen.tsx:254`), library name (`features/library/LibraryScreen.tsx:331`), collection name (`features/library/components/GroupDetail.tsx:173`) and the new-collection field.
- Backend: mural and folder create reject names over 200. An update rejects a name over 200 only when it differs from the stored name, because installed mobile builds resend the unchanged name on every save (`MuralEditorScreen.tsx:182`) and cannot be updated soon (OTA is down until 11-01); a mural already named over 200 characters keeps saving until someone renames it (my call). New clients also send `name` only when it changed.
- Library and collection names live inside the library JSON the backend does not inspect, so they are capped client-side only. Web gets the same `maxLength` on the same fields.

### Quiz results (#6)

The user's decisions: a player's score screen shows the correct book for every question they got wrong; replay protection stays as it is (signed in: one play per account; guest: one play per stored device play id), and a guest who clears their data can play again, which is accepted; anonymous plays are marked as anonymous wherever plays are listed so they can be told apart later.

- **Correct answers.** After submitting, the player's score view shows, per question, their pick and the correct book. For `title_cover` (prompt is a title, options are covers) the correct answer is the prompt's title with the correct cover; a wrong pick shows the picked cover. The backend returns the correct choice per question only in the response to a play that exists for this player (submit and `getPlay`, which already authenticates a guest by their stored `playId`), never in `PublicQuizQuestion` before a play. Anyone holding a guest's `playId` can read that play's answers; accepted, since it is that player's own play. No answers on a new device for a guest (my call). Builder decides the exact contract shape.
- **Player identity.** No schema change: `voter_user_id IS NULL` already marks a guest play (`backend/src/modules/quizzes/service.ts:314`). Results/leaderboard entries gain an `anonymous` flag. Signed-in plays show the account's current username, resolved at read time so existing plays labelled "Guest" are corrected. A signed-in player is named even when their profile is private or hides votes (user's decision, 2026-10-25, replacing an earlier `canNameAsParticipant` gate), which also removes the case of a typed name impersonating a hidden player. A signed-in player with no username shows their typed name, or "Reader", with no guest tag. Guest plays show the typed name, or "Guest", with a visible guest tag. Run the `security-review` skill before this merges.
- **Accepted gap** (user's decision): a signed-in user can play once as a guest in a private window, read the answers, then play signed in. Guest plays are tagged, so this is visible later.
- **Old/new mismatch.** `answers` is optional in the response type; a client talking to a backend that doesn't send it renders the score without correct-answer rows.
- **Owner results screen** (`QuizEditorScreen.tsx`): "View results →" in Activity (`features/home/feedRowModel.ts:96`) opens the Results tab via a route param read in `app/(app)/(home,arena)/quiz/[id].tsx`. Rows read "Q{n} · {title of the book the question is about}" (1-based, from the question's position) instead of the raw `q0` id (`QuizEditorScreen.tsx:147`); the prompt itself can be a cover URL or a long quote, so the subject book's title labels it. The bare `#{choiceIndex+1}` (`:149`) becomes the chosen book's title.
- **Web** has the same raw ids and "Guest" labels (`frontend/src/pages/QuizEditorPage.tsx:296,311`, `frontend/src/pages/PlayQuizPage.tsx:269`) and gets the same fixes, including the correct-answers score view.

### Dead ends and missing feedback

**#5 Required fields.** `features/library/components/AddBookForm.tsx` marks Title and Author as required. `features/arena/ArenaSeedScreen.tsx`: a line under Start says every slot must be filled while it is disabled, and Random fill says it needs books in the library when the library is empty.

**#9 Add to library.**
- Adding by hand (`AddBookForm.tsx:132-135`) shows a brief "Added" toast through the app-level toast host from #15, so it survives the sheet closing.
- `AddBookSheet` (`features/community/AddBookSheet.tsx:57-70`) already toasts "Added/Updated in your library." inside the sheet, and the server already re-shelves an owned book and reports `updated`. Reproduce first why the sweep saw no confirmation (the sheet closing 1.6s after the toast, or the toast hidden), then fix that; keep the in-sheet `Toast`, since an app-level toast renders under an RN `Modal`.
- For a book already in the library — matched with `isCertainMatch` (`packages/shared/src/library/bookMatch.ts:82-85`), the rule the server's `addBook` uses — the sheet reads "Update status" with the current status preselected. It uses the same add call; no second write path.
- Search: owned results already move out of the results list into the library section (`features/search/searchModel.ts:134`, `SearchScreen.tsx:57-58`). "Dune" kept its "+" because the library query is invalidated only when `status !== 2` (`AddBookSheet.tsx:57`). Invalidate after every add or update so the result moves at once.

**#10 Switch shelf mural with no murals.** The picker (`features/community/ProfileScreen.tsx:248-300`, opened from `features/community/MyShelfScreen.tsx:172`) shows an empty state with a "Create a mural" action when there are no murals.

**#11 Deleting a game.** Game cards (`features/community/DiscoverRow.tsx`, used by `features/arena/ArenaHomeScreen.tsx:219`) get a `⋯` `Menu` (`ui/components.tsx:699`) with a destructive Delete that opens the existing delete `Dialog`. Long press stays. The mural delete confirm (`features/murals/MuralsScreen.tsx:125`) adds that its public link stops working, the way arena's `DELETE_EFFECT` (`features/arena/arenaHome.ts:42-46`) names what is lost.

**#21 Top Shelf filters.** Reproduce first. `features/topShelf/TopShelfScreen.tsx:59,67` already pads by `barHeight`, so the ~100dp overlap means the measured height is wrong or an inset is not counted. Also, a vertical swipe that starts on the floating bar or a carousel does not scroll the page. Fix both so content is readable above the bar at rest and the page scrolls from anywhere. Moving the bar out of the overlay is acceptable if that is the simplest fix.

### Design system

**#7, #13 Touch targets.** Question-count chips (`features/quizzes/QuizCreateScreen.tsx:199`, `QuizEditorScreen.tsx:177`) get `minHeight: minimumTouchTarget`. Bracket round markers (`features/arena/BracketRounds.tsx:355-360`) get a 44pt target with the dot still aligned to the rail (`:401`). Check the Settle button (`:197`) against 44pt too.

**#14 Labelled Save.** `SaveStateButton` (`ui/components.tsx:266-268`) renders as a labelled, framed `IconButton`: "Save" in accent while unsaved, "Saving…" while saving, "Saved" with a checkmark when saved (DESIGN.md Headers). One change covers the three editors. Gallery (`features/gallery/GalleryScreen.tsx:101,112`): the header upload action is labelled "Upload", and the empty state gets an "Upload image" action.

**#15 Native alerts.** Add one reusable themed confirm built on `Dialog` (`ui/components.tsx:402`, declarative `visible`), following the pattern at `ArenaHomeScreen.tsx:125`: title, body, cancel, and a confirm that can be destructive and show loading. Every `Alert.alert` confirm moves to it (13 sites, listed below). Every `Alert.alert` used to report an error or a result moves to a toast (17 sites). Several of those sites are hooks or sheets with no screen of their own (`useLibraryActions.ts`, `ShareActions.tsx`, `DuplicatesSheet.tsx`), and some fire after the surface closes, so a per-screen `Toast` cannot show them. Add one app-level toast host and a `useToast()`-style hook, mounted once at the app root and rendering the existing `Toast` component, the mobile counterpart of web's `frontend/src/components/Toaster.tsx` (my call). Existing per-screen `Toast` uses may stay. The host renders under RN `Modal`s (`Dialog`, `Sheet`, `ConfirmDialog`), so a toast must not fire while one is open: close the dialog first, or keep the error inline in it. Success messages sent through `Alert.alert` (e.g. "Posted" in `ShareActions.tsx:17`) move to it too. Afterwards `rg "Alert.alert" mobile/src` finds nothing. Whether the confirm is a component with local state or a hook returning an awaitable `confirm()` (as web's `frontend/src/components/ConfirmDialog.tsx`) is the builder's call; prefer whichever leaves less code at 13 call sites.

Confirms: `features/settings/SettingsScreen.tsx:45`, `features/gallery/GalleryScreen.tsx:87`, `features/library/LibraryScreen.tsx:119`, `features/library/components/GroupDetail.tsx:68,104`, `features/library/components/ShareSheet.tsx:45`, `features/library/components/CoverPicker.tsx:72`, `features/works/BookScreen.tsx:78`, `features/arena/ArenaViewScreen.tsx:83`, `features/socials/SocialsSection.tsx:40`, `features/murals/MuralsScreen.tsx:125,143`, `features/quizzes/QuizPlayScreen.tsx:68`.

Errors: `app/account-security.tsx:53`, `app/(app)/(library)/style.tsx:21`, `features/library/LibraryScreen.tsx:126`, `features/library/components/GroupsView.tsx:104`, `features/library/components/GroupDetail.tsx:56,82,113`, `features/library/components/DuplicatesSheet.tsx:28`, `features/library/FinishedScreen.tsx:59`, `features/library/components/ShareSheet.tsx:54`, `features/library/components/CoverPicker.tsx:81`, `features/library/hooks/useLibraryActions.ts:39,43`, `features/socials/ShareActions.tsx:17,19`, `features/murals/MuralsScreen.tsx:146,161`.

**#19 Sentence case everywhere** (user's decision). Remove every uppercase transform from labels: `textTransform: "uppercase"` and its letter-spacing in `genreLabel` (`features/murals/MuralCanvas.tsx:566`, the only one in mobile) and every `uppercase` class in `frontend/src` (mural eyebrows in `MiscBlocks.tsx:35-36` and `BookBlocks.tsx:70`, section labels on profile, shelf, activity, style controls, finish sheet, murals list, bracket labels, and the landing previews that mimic the app). Literal copy stays ("WINS"/"LOSES" in `mobile/src/features/arena/ArenaVoteDeck.tsx:98-99`). Edit DESIGN.md:136 so mural block titles are sentence-case eyebrow headings (`text-dim`), consistent with DESIGN.md:53.

### Copy

**#16 One name per action.**
- "Import library" everywhere: the button in `features/library/LibraryScreen.tsx:224` drops its ellipsis. The Library menu item (`:142`) and the import sheet title (`app/(app)/(home,library,search,you)/import.tsx:11`, currently "Import more / sync Goodreads" when the library has books) use the same name. A menu item that opens a sheet may keep an ellipsis if the app's other menu items do.
- "Add a book" everywhere: `features/community/MyShelfScreen.tsx:225` "Add a book manually" becomes "Add a book".
- Home's empty state (`features/home/HomeScreen.tsx:45,53`) keeps one filled accent button ("Import library"). "Find readers" becomes secondary.
- Quiz creation says "library", not "shelf" (`features/quizzes/QuizCreateScreen.tsx:158`).
- Web strings for the same actions follow (`frontend/src/components/OwnShelfView.tsx:216`, `frontend/src/pages/HomePage.tsx`, `frontend/src/pages/LibraryPage.tsx:341`).

**#17 Atmyshelf, not Scripta.** `features/topShelf/recapModel.ts:18,38,40` and `features/topShelf/RecapCard.tsx:96` say Atmyshelf, with tests (`recapModel.test.ts:17,33,36`) updated. `packages/shared/src/works/labels.ts:17` `gameOwnerLabel("app")` returns "Atmyshelf" (test `packages/shared/src/works/bookScreen.test.ts:89`). `backend/src/modules/library/domain/sizeLimit.ts:8,12` ("the most Scripta can store", shown through the 413 passthrough) changes too, with its exact-match tests. Any other user-visible "Scripta" found by `rg Scripta` in mobile, frontend and user-facing backend messages changes too. Package names, test fixtures not shown to users, and identifiers stay.

### Console errors

- **Require cycle** between `packages/shared/src/library/merge.ts:4` and `catalogGenres.ts:2`: move `GENRES_FROM_CATALOG` to a module neither imports back (e.g. `bookGenres.ts`, which `catalogGenres.ts` already imports).
- **"Can't perform a React state update on a component that hasn't mounted yet"** on the first Home load after sign-up: likely `useAccountAppearanceSync` (`features/settings/appearanceSync.ts:28-42`) setting state after an awaited fetch with no cancellation; `GenreEnrichment` (`app/(app)/_layout.tsx:16`) is the other candidate. Confirm the source before fixing; if it cannot be reproduced, say so rather than adding speculative guards.

## Delivery

Three PRs in order, each independently mergeable:

1. **Bugs and data loss:** #1, #2, #3, #4, #6, #8, #12, #18, #20, the console errors.
2. **Dead ends and feedback:** #5, #9, #10, #11, #21.
3. **Design system and copy:** #7, #13, #14, #15, #16, #17, #19.

The app-level toast host from #15 is built in PR 2, because #9 needs it; PR 3 moves the error alerts onto it. #1's confirm uses #15's themed dialog. Either PR 1 builds that dialog component and PR 3 migrates the remaining call sites onto it, or PR 1 uses the existing `Dialog` inline. The builder picks; the dialog is built once.

Rendered mobile changes get a `device-checker` pass before merge; changed web screens get a browser check in the built-in browser. #2 and #21 start with a device repro.

Backend changes (#6, #12) need no data migration and no production command. They ship with the next batch deploy.

## Left to the builder

- Exact API shape for correct answers and the `anonymous` flag (#6).
- Confirm dialog as component or hook (#15).
- Wording of hints and captions (#4, #5, #10, #11), following DESIGN.md voice.
