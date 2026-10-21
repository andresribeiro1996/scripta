# Overflow Action Sheet Implementation Plan

**Goal:** Every `⋯` (and row "settings") overflow menu in the mobile app opens a themed bottom sheet with icons and grouped rows, instead of Material's stock dropdown, which ignores the app theme and drops the title on Android.

**Design reference:** https://claude.ai/artifact/1AG5V27deeqE4JMSrmmRAi, option B.

**Architecture:**
- New `ActionSheet` in `mobile/src/ui/components.tsx`, built on the existing `Sheet`. Native `Menu` stays for short one-of-N pickers next to their control: reading status and "How it landed" (`BookScreen.tsx`), editions (`EditionStrip.tsx`), the sort cycle (`SearchDock.tsx`), and the gallery's `Menu` demo.
- No native dependency, no rebuild. Ships over the air.

## Global constraints

- No comments in code (root `AGENTS.md`). Put the why in the commit message.
- Minimum code. Reuse `Sheet`, `Icon`, `useTheme`, tokens from `theme.tsx`. No new colours, radii or spacing.
- Not in scope (YAGNI): per-row hints, chevrons, submenus, selected/check state, disabled rows, swipe-to-dismiss, haptics.
- Verify: `npm run build --workspace @scripta/shared`, `npm run typecheck --workspace mobile`, `npm test --workspace mobile`.
- Commits end with the attribution lines the session gives you. Stage and commit in one command.

## Task 1: `ActionSheet` component and glyphs

**Files:**
- Modify: `mobile/src/ui/components.tsx`
- Modify: `mobile/src/ui/icon.tsx`

**API:**

```ts
export type ActionItem = { label: string; icon: IconName; destructive?: boolean; onPress: () => void };

export function ActionSheet({ title, groups, children }: {
  title: string;
  groups: ActionItem[][];
  children: (open: () => void) => ReactNode;
}): JSX.Element
```

- `children` is a render prop: the call site renders its own trigger and calls `open` from its `onPress`. The trigger keeps its own `accessibilityLabel`, hit slop and pressed state. No `pointerEvents="none"` wrapper.
- Empty groups are skipped. A `border` hairline separates consecutive non-empty groups.
- Renders `<Sheet visible title onClose>`. Each row is a `Pressable` with `accessibilityRole="button"`, `minHeight: minimumTouchTarget`, `surfacePressed` background while pressed. Inside: a 32×32 tile (`radii.md`), `accentSoft` background with an `accent` 18pt `Icon`; label in `typography.body` weight 600 with `dynamicType`. Destructive rows use `dangerSoft` / `danger` for the tile and `danger` for the label.
- Pressing a row closes the sheet, then runs `onPress`. iOS can't present a modal while another is dismissing, so on iOS the action runs from `Modal`'s `onDismiss` (iOS-only in RN 0.86; `node_modules/react-native/Libraries/Modal/Modal.js:318`). On Android, run it right after closing. Add an optional `onDismiss` to `OverlayProps` and pass it to `Modal` in `Overlay`.
- Rows bleed to the sheet edges: the sheet has `spacing.xl` padding, so give the rows' container `marginHorizontal: -spacing.xl` and the rows `paddingHorizontal: spacing.xl`.

**Glyphs to add to `GLYPHS` in `icon.tsx`:**
- `sync`: ios `arrow.triangle.2.circlepath`, android `sync`
- `reorder`: ios `arrow.up.arrow.down`, android `reorder`
- `select`: ios `checkmark.circle`, android `check_circle`

**Commit:** "Add ActionSheet for overflow menus".

## Task 2: move overflow menus to `ActionSheet`

**Files:**
- Modify: `mobile/src/features/library/LibraryScreen.tsx`
- Modify: `mobile/src/features/library/components/GroupDetail.tsx`
- Modify: `mobile/src/features/works/BookScreen.tsx`
- Modify: `mobile/src/features/works/WorkScreen.tsx`
- Modify: `mobile/src/app/(app)/(home,arena,library,search,you)/book/[key]/index.tsx`
- Modify: `mobile/src/features/tierlists/TierlistEditorScreen.tsx`
- Modify: `mobile/src/features/tierlists/TierBoard.tsx`
- Modify: `mobile/src/features/quizzes/QuizEditorScreen.tsx`
- Modify: `mobile/src/features/community/MyShelfScreen.tsx`
- Modify: `mobile/src/features/arena/ArenaViewScreen.tsx`
- Modify: `mobile/src/features/murals/MuralsScreen.tsx`

Drop every trailing "…" from these labels. Keep each item's existing condition and `onPress` as it is. Groups, in order (`|` separates groups):

| Site | Title | Groups |
|---|---|---|
| `LibraryScreen` | library name, else "Library" | Rename library `edit`, Reorder `reorder` (if), Select `select` (if) \| Library style `style`, Import / sync `sync` \| Share `share` |
| `GroupDetail` | `group.name` | Style `style` (if series), Manage books `book`, Select `select` (if) \| Delete `delete` destructive |
| `bookMenuItems` (`BookScreen.tsx`) → `WorkScreen`, `book/[key]` | `work.title` / the book's title from the row, else "Book" | one group: Card style `style`, Change cover `image`. Return `ActionItem[]`. |
| `TierlistEditorScreen`, frozen | `current.name` | Close voting `lock` / Reopen voting `vote` \| Require members `community` / Allow anyone `public` |
| `TierlistEditorScreen`, editable | `current.name` | Rename `edit` \| Add books `add`, Add tier `tierlist` \| Open voting `vote` |
| `TierBoard` tier row | tier label, else "Untitled" | Edit tier `edit` \| Move up `expandVertical` (if), Move down `expandVertical` (if) |
| `QuizEditorScreen`, frozen | `current.name` | Share challenge link `share` \| Open/Close for play `public` / `lock` |
| `QuizEditorScreen`, editable | `current.name` | Publish `public` |
| `MyShelfScreen` | "My shelf" | Edit shelf `edit` (if), Switch shelf mural `murals` \| Feed settings `settings` |
| `ArenaViewScreen` | `data.name` | See all N books / View book pool `book` \| Rename `edit` (if owner) |
| `MuralsScreen` mural tile | `item.name` | Move to folder `folder`, Change cover `image` \| Share `share` \| Delete `delete` destructive |
| `MuralsScreen` folder | `folder.name` | Rename folder `edit` \| Delete folder `delete` destructive |

Triggers: pass `onPress={open}` to the existing `IconButton`. The two `MuralsScreen` triggers are plain `View`s today; make each a `Pressable` with the same style, role and label, calling `open`.

Remove now-unused `Menu` / `MenuItem` imports. `Menu` and `MenuItem` stay exported for the pickers.

**Commit:** "Open overflow menus as a themed action sheet".

## Task 3: docs and gallery

**Files:**
- Modify: `DESIGN.md`
- Modify: `mobile/src/app/gallery.tsx`

- `DESIGN.md`, Headers section: the `⋯` trigger opens an `ActionSheet` (grouped rows, icon tiles, destructive group last); native `Menu` is only for short one-of-N pickers anchored to their control.
- `gallery.tsx`: add an "Open action sheet" `Button` beside "Open menu" with two groups, one destructive row.

**Commit:** "Document the overflow action sheet".
