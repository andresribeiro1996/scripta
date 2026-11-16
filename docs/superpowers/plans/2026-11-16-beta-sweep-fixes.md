# Beta sweep 2026-11-16 fixes

Spec: the sweep report at `beta-tests/2026-11-16-0011/report.md` (main checkout root), findings #1–#17. Decisions below are settled; don't reopen them.

Rules for every task: mobile strings go through `t()` with en **and** pt-PT keys (`mobile/src/i18n/messages/{en,pt-PT}/*.ts`; parity is tested). Only `.ts` tests run in mobile (`node --import tsx --test "src/**/*.test.ts"`), so logic worth testing gets extracted into a pure function beside its component and tested there. Run each touched package's typecheck/lint/test before committing.

Out of scope: #17 "Favourites" spelling (the report was wrong — en catalogs use British spelling throughout; leave it), the not-reproduced seed-form edit loss in #10, `@expo/ui` BottomSheets for #14, DESIGN.md's ToggleSwitch size (44×24 vs the 48×28 component).

## Task 1 — Navigation and form bugs (#1, #6, #10, #14)

Files:
- Modify: `mobile/src/features/library/components/LibraryShareImage.tsx`
- Create: `mobile/src/features/library/components/shareImageReady.ts`
- Test: `mobile/src/features/library/components/shareImageReady.test.ts`
- Modify: `mobile/src/app/(app)/_layout.tsx`
- Modify: `mobile/src/ui/components.tsx`
- Modify: `mobile/src/features/arena/ArenaSeedScreen.tsx`
- Modify: `packages/shared/src/arena/arenaSeed.ts`
- Test: `packages/shared/src/arena/arenaSeed.test.ts`
- Modify: `mobile/src/i18n/messages/en/arena.ts`
- Modify: `mobile/src/i18n/messages/pt-PT/arena.ts`

- **#1** `LibraryShareImage.tsx:74-78`: readiness requires `expected.length > 0` for Wall/Shelf, so an empty shelf (or a filter/search with 0 books) never reports ready. Ready = every expected cover loaded (vacuously true when none). Extract the expression to `shareImageReady.ts` with a test covering empty, partially loaded and fully loaded.
- **#6** Decision: back from any other tab's root goes to Home **at its root**; back on Home's root exits. Keep the Tabs' default `firstRoute` back behavior and set `popToTopOnBlur: true` on the `(home)` tab screen only, so Home's stack is at its root whenever another tab is showing. Other tabs keep their stacks.
- **#14** `Overlay` (`components.tsx:~381-415`, RN `Modal onRequestClose={onClose}`): Android back while the keyboard is open must only dismiss the keyboard. If `Keyboard.isVisible()` is already false when `onRequestClose` fires on device, track the last `keyboardDidHide` time and ignore a close within ~300 ms. Covers Dialog, Sheet, ConfirmDialog, ActionSheet. Device-verify.
- **#10** Seed tournament (`ArenaSeedScreen.tsx`):
  - Name: empty initial value with `placeholder={t("arena.untitledTournament")}`, like `TierlistCreateScreen`; the existing `name.trim() || …` fallback stays.
  - Round duration: an empty field means the default 24 h (show `24` as placeholder). A value that is not a number, rounds to under 1 minute, or exceeds 720 h shows an inline error naming the range (new key, en + pt-PT) and disables Create and Random fill. Change `arenaSeed.ts` so callers can tell empty from invalid (e.g. return `null` for invalid non-empty input) and update `arenaSeed.test.ts`; grep `frontend/` for other callers and keep them compiling with unchanged web behavior.

## Task 2 — Murals (#5, #12, #15, #3 mural header, #4, #17 quote + folders label)

Files:
- Modify: `packages/shared/src/murals/blockKinds.ts`
- Test: `packages/shared/src/murals/blockKinds.test.ts`
- Modify: `packages/shared/src/murals/murals.ts`
- Test: `packages/shared/src/murals/murals.test.ts`
- Modify: `mobile/src/features/murals/MuralCanvas.tsx`
- Create: `mobile/src/features/murals/canvasText.ts`
- Test: `mobile/src/features/murals/canvasText.test.ts`
- Modify: `mobile/src/features/murals/MuralEditorScreen.tsx`
- Modify: `mobile/src/features/murals/MuralsScreen.tsx`
- Modify: `mobile/src/features/library/components/StyleControls.tsx`
- Modify: `mobile/src/i18n/messages/en/murals.ts`
- Modify: `mobile/src/i18n/messages/pt-PT/murals.ts`

- **#5 / #12 clipping**: blocks are fixed-height boxes (`h * ROW_HEIGHT(36) - ROW_GAP`, `overflow: hidden`). Give Stats and Reader profile a default size and `minHeight` in `blockKinds.ts` large enough that their content fits at the default text size on mobile with every option on (Stats: eyebrow, hero number, bar, legend; Reader profile: header, chips, genres, "Based on N of N books"). Derive the rows from the styles in `MuralCanvas.tsx`, state the arithmetic in the commit message. Confirm `ensureBookBlockHeights` (`murals.ts:~166`) enforces `minHeight` for these kinds too (it runs on the shared page) and test that an existing too-short Stats block is grown and neighbours pushed. The Shelf's partially visible third cover is a horizontal-scroll peek: leave it. Text block clipping at its user-chosen height: leave it.
- **#12 unfilled Image block**: on a non-editable canvas (shared page), a block whose image is missing renders nothing at all (no box, no "Image unavailable"). The editor keeps an owner-facing placeholder.
- **#15** Image picker in `MuralEditorScreen.tsx:~346`: when the gallery query succeeded and is empty, show `EmptyState` with `addBook.galleryEmptyTitle`/`galleryEmptyBody` and an action labelled `shell.youGallery` that closes the picker and `router.push("/gallery")`. While loading show nothing extra (no "Nothing available" flash). Book and tier list pickers unchanged.
- **#3 mural header** (`MuralEditorScreen.tsx:221-226`): keep `SaveStateButton`; move Preview light/dark, Mural theme and Share mural into one `⋯` `ActionSheet` (pattern: `TierlistEditorScreen.tsx:154`). Check the sheet renders with the app theme, not the mural theme scope.
- **#4** `ToggleRow` (`StyleControls.tsx:100-111`): use `ToggleSwitch` from `ui/components.tsx`, label and switch on one row (`FeedSettingsDialog.tsx` `feedRow` is the model).
- **#17 quote placeholder** (`MuralCanvas.tsx:222`): typographic quotes only around a real highlight, never around `murals.noEligiblePassage`. Extract to `canvasText.ts` and test.
- **#17 folders label** (`MuralsScreen.tsx:190`): with no folder selected the accessibility label is `murals.folders` alone, not "Folders, Folders". Put the label choice in `canvasText.ts` (or a sibling pure helper) and test it.

## Task 3 — Dead ends and feedback screens (#9, #16, #7, #13, #17 forgot password + tier heading)

Files:
- Modify: `mobile/src/features/quizzes/QuizEditorScreen.tsx`
- Modify: `mobile/src/features/library/components/ImportForm.tsx`
- Modify: `mobile/src/app/account-security.tsx`
- Modify: `mobile/src/app/forgot-password.tsx`
- Modify: `mobile/src/features/tierlists/TierlistCreateScreen.tsx`
- Modify: `mobile/src/features/dailyChapter/daily-chapter-screen.tsx`
- Modify: `mobile/src/features/dailyChapter/daily-chapter-day-screen.tsx`
- Modify: `scripts/devDailyChapterPlan.mjs`
- Test: `scripts/devDailyChapterPlan.test.mjs`
- Modify: `mobile/src/i18n/messages/en/quizzes.ts`
- Modify: `mobile/src/i18n/messages/pt-PT/quizzes.ts`
- Modify: `mobile/src/i18n/messages/en/shell.ts`
- Modify: `mobile/src/i18n/messages/pt-PT/shell.ts`

- **#9** Quiz Results tab (`QuizEditorScreen.tsx:~145-152`): when results loaded with zero plays, show `EmptyState` titled `quizzes.noPlays`, a body saying plays appear once people take the challenge (new key), action `quizzes.shareChallengeLink` calling the existing `shareChallengeLink`.
- **#16** Import sheet (`ImportForm.tsx:105-112`): "Choose a file…" first (the primary action, visible at the sheet's 60% detent), then the intro and format notes, then "Save CSV template". Copy unchanged. The deep-link backdrop is out of scope.
- **#7** `account-security.tsx`: title uses `shell.youAccountSecurity` (matches its entry); delete `shell.account` if nothing else uses it. Put "Send verification email" and "Correct email" together directly under the email line and the `emailDeliveryUnavailable` note, with "Change password" after them, so the note sits with the two controls it explains.
- **#13** Daily Chapter dates:
  - `daily-chapter-screen.tsx:82`: the `{theme} · {date}` line uses `dailyChapterDayLabel(date, locale)` from `@scripta/shared` instead of the ISO date.
  - `daily-chapter-day-screen.tsx:33`: replace the hard-coded `` `${shown.date} · ${shown.title}` `` with the readable day label as the header title; make sure the edition title still appears in the screen content.
  - `devDailyChapterPlan.mjs:106`: fixture title is the theme name alone (real editions have editorial titles without dates); assert it in the test.
- **#17 forgot password**: the screen opened by "Forgot password?" is titled "Reset password" (en; pt-PT equivalent), replacing `shell.recoverAccount` if unused elsewhere.
- **#17 tier list step 3**: a visible heading `t("tierlists.visibility")` above the Private/Public `Segmented`, same pattern as the "Top tier means" heading at `TierlistCreateScreen.tsx:81`.

## Task 4 — Design-system and copy (#2, #3 book/Home, #8, #11)

Files:
- Modify: `mobile/src/features/dailyChapter/daily-chapter-card.tsx`
- Modify: `mobile/src/features/home/HomeScreen.tsx`
- Modify: `mobile/src/features/works/WorkScreen.tsx`
- Modify: `DESIGN.md`
- Modify: `mobile/src/i18n/messages/en/sharing.ts`
- Modify: `mobile/src/i18n/messages/pt-PT/sharing.ts`
- Test: `mobile/src/features/topShelf/topShelfModel.test.ts`
- Modify: `mobile/src/features/library/components/ShareLayoutPicker.tsx`

- **#2** Home with an empty library: the Daily Chapter card's play button is `secondary` (the empty-library "Import library" stays the one primary). With books, unchanged. Put the choice in a pure helper beside the card's model and test it.
- **#3 book screen** (`WorkScreen.tsx:135-136`): Share becomes an `IconButton` with `label` + `framed`.
- **#3 Home header** — decision: document, don't change code. DESIGN.md Headers (line ~182): add Home's saved-games bookmark to the framed-glyph exceptions beside the bell, with the reason (a second labelled pill crowds the title at 360dp). Confirm the bookmark is `framed`; if not, make it framed.
- **#8** `sharing.valueChampions`: `{ one: "{count} pt", other: "{count} pts" }` in en and pt-PT; add `valueLabel("champions", 1, "en") === "1 pt"` to `topShelfModel.test.ts`.
- **#11** `ShareLayoutPicker.tsx`: all four labels render at the same size at 360dp. Drop `adjustsFontSizeToFit`/`minimumFontScale`; make room by showing the check only on the selected segment (no reserved slot or trailing spacer on unselected ones) while keeping labels centred.

## Verify

`node scripts/gate.mjs` before each commit. After all tasks: one `device-checker` pass at 360dp on Home (empty library), Library › Share as image (empty), a mural with Stats + Reader profile + empty Image (editor and its public link), mural Rename dialog back-with-keyboard, back from You root, seed tournament duration 0, quiz Results with no plays, Import sheet, Daily Chapter screen.
