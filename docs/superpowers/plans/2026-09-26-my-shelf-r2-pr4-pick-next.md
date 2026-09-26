# My shelf release 2, PR 4: Pick my next read. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reader who can't decide what to read next taps "Can't choose?" on Home's Up next, picks between two unread books, and the winner becomes the book being read.

**Architecture:**
- Each client adds one small sheet component and a link on Home's Up next section.
- The duel buttons reuse the finishing moment's styling, extracted into a shared component per client.
- Choosing a book goes through the same status save the book sheet already uses.
- Nothing is added to `@scripta/shared`.

**Tech Stack:** Expo Router + React Native (mobile), React + Tailwind (web).

**Spec:** `docs/superpowers/specs/2026-09-26-my-shelf-release-2-design.md`, section "4. Pick my next read".

## Global Constraints

- **Exact copy:** link `Can't choose?`, sheet title `Pick your next read`, buttons `This one` and `Another pair`, error `Couldn't save the status change.`
- **When the link shows:** only when Up next has at least two books.
- **Which books:**
  - The pair is the Up next books at positions `offset` and `offset + 1`, taken modulo the list length. The offset starts at 0.
  - `Another pair` adds 2, which wraps around at the end.
  - The candidates are all of the Up next card's `bookKeys`, not only the ones shown on Home.
- **Choosing:**
  - The winner moves to Reading through the existing status save: mobile's `useLibraryActions().setStatus(book, 1)`, and on web `updateLibrary` with `setReadStatus(b, 1, localDay())`, the same mapping `LibraryPage`'s `handleSetBookStatus` uses.
  - On success, close the sheet.
  - On failure, keep the sheet open and show the status error: mobile's `setStatus` already raises an `Alert`, and web shows a toast.
- Nothing else changes: no date, no shelf update, no new event.
- No code comments; no new packages. In a worktree session, run git as `/usr/bin/git …` and don't run `npm install`.
- **Android pitfall:** a multi-word label in a box sized to its own text can lose its last word. Buttons already stretch their label, and new pills use `numberOfLines={1}`.

---

### Task 1: Mobile

**Files:**
- Create: `mobile/src/features/library/components/DuelButton.tsx` (moved from `FinishedScreen.tsx`)
- Modify: `mobile/src/features/library/FinishedScreen.tsx` (import `DuelButton` instead of defining it)
- Create: `mobile/src/features/home/PickNextSheet.tsx`
- Modify: `mobile/src/features/home/HomeScreen.tsx` (the Up next section at `:100-106`, and its `SectionHeader`)

**Interfaces:**
- Produces: `DuelButton({ label, onPress }: { label: string; onPress: () => void })`, and `PickNextSheet({ visible, keys, books, onClose }: { visible: boolean; keys: string[]; books: Array<Record<string, unknown>>; onClose: () => void })`.

- [ ] **Step 1: Extract `DuelButton`**

Move `DuelButton` and its two styles (`duelButton`, `duelButtonText`) from `FinishedScreen.tsx:211-241` into `components/DuelButton.tsx` unchanged, exported. Import it back in `FinishedScreen.tsx`. Run `npm run typecheck --workspace mobile`.

- [ ] **Step 2: `PickNextSheet`**

```tsx
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { bookKey } from "@scripta/shared";
import { Button, Sheet, spacing, typography, useTheme } from "../../ui";
import { CoverImage } from "../library/components/CoverImage";
import { DuelButton } from "../library/components/DuelButton";
import { useLibraryActions } from "../library/hooks/useLibraryActions";

export function PickNextSheet({ visible, keys, books, onClose }: { visible: boolean; keys: string[]; books: Array<Record<string, unknown>>; onClose: () => void }) {
  const { colors } = useTheme();
  const { setStatus } = useLibraryActions();
  const [offset, setOffset] = useState(0);
  const [saving, setSaving] = useState(false);
  const pair = [keys[offset % keys.length], keys[(offset + 1) % keys.length]]
    .map((key) => books.find((book) => bookKey(book) === key))
    .filter((book): book is Record<string, unknown> => Boolean(book));

  async function choose(book: Record<string, unknown>) {
    if (saving) return;
    setSaving(true);
    const saved = await setStatus(book, 1);
    setSaving(false);
    if (saved !== false) onClose();
  }

  return (
    <Sheet visible={visible} title="Pick your next read" onClose={onClose}>
      <View style={styles.pair}>
        {pair.map((book) => (
          <View key={bookKey(book)} style={styles.side}>
            <View style={[styles.cover, { backgroundColor: colors.border }]}><CoverImage book={book} /></View>
            <Text numberOfLines={2} style={[typography.body, { color: colors.text, textAlign: "center" }]}>{String(book.Title ?? "Untitled")}</Text>
            <DuelButton label="This one" onPress={() => void choose(book)} />
          </View>
        ))}
      </View>
      {keys.length > 2 ? <Button label="Another pair" variant="secondary" disabled={saving} onPress={() => setOffset((value) => value + 2)} /> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  pair: { flexDirection: "row", gap: spacing.md, alignItems: "stretch" },
  side: { flex: 1, gap: spacing.sm },
  cover: { aspectRatio: 2 / 3, borderRadius: 6, overflow: "hidden" },
});
```

Match the import paths for `Sheet`, `Button`, `CoverImage` and the theme tokens to how `MuralsScreen.tsx` and `BookDetail.tsx` import them.

`setStatus` returns `undefined` when the status is already Reading. That can't happen here, because Up next books are To read, but it's treated as success.

- [ ] **Step 3: The link on Home**

In `HomeScreen.tsx`, give `SectionHeader` an optional `action?: { label: string; onPress: () => void }`, rendered as a text-styled `Pressable` on the right with `accessibilityRole="button"`. For the Up next section:

```tsx
const [picking, setPicking] = useState(false);
…
<SectionHeader
  title="Up next"
  count={String(upNextCard.bookKeys.length)}
  action={upNextCard.bookKeys.length >= 2 ? { label: "Can't choose?", onPress: () => setPicking(true) } : undefined}
/>
…
<PickNextSheet visible={picking} keys={upNextCard.bookKeys} books={books} onClose={() => setPicking(false)} />
```

Place the `useState` with the component's other hooks, above any early return.

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck --workspace mobile && npm test --workspace mobile`
Expected: PASS.

```bash
/usr/bin/git add mobile/src
/usr/bin/git commit -m "Mobile: Pick my next read from Up next"
```

---

### Task 2: Web

**Files:**
- Create: `frontend/src/components/DuelButton.tsx`
- Modify: `frontend/src/components/FinishSheet.tsx` (use `DuelButton` instead of `duelButtonClass` buttons)
- Create: `frontend/src/components/PickNextSheet.tsx`
- Modify: `frontend/src/pages/HomePage.tsx` (the Up next section at `:38-47`)

**Interfaces:**
- Produces: `DuelButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean })`, and `PickNextSheet({ keys, books, onClose }: { keys: string[]; books: Array<Record<string, unknown>>; onClose: () => void })`.

- [ ] **Step 1: Extract `DuelButton`**

```tsx
import type { ReactNode } from "react";

export function DuelButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="flex min-h-16 flex-1 items-center justify-center rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-center text-sm font-semibold hover:bg-(--color-surface-hover) disabled:opacity-50">
      {children}
    </button>
  );
}
```

Replace the two `duelButtonClass` buttons in `FinishSheet.tsx` with `DuelButton`, keeping their contents and handlers (including any `line-clamp-2` span inside), and delete `duelButtonClass`.

- [ ] **Step 2: `PickNextSheet`**

```tsx
import { useState } from "react";
import { bookKey, localDay, setReadStatus } from "@scripta/shared";
import { useLibrary } from "../hooks/useLibrary";
import { CoverImage } from "./BookCard";
import { DuelButton } from "./DuelButton";
import { Sheet } from "./Sheet";
import { useToast } from "./Toaster";

export function PickNextSheet({ keys, books, onClose }: { keys: string[]; books: Array<Record<string, unknown>>; onClose: () => void }) {
  const { updateLibrary } = useLibrary();
  const toast = useToast();
  const [offset, setOffset] = useState(0);
  const [saving, setSaving] = useState(false);
  const pair = [keys[offset % keys.length], keys[(offset + 1) % keys.length]]
    .map((key) => books.find((book) => bookKey(book) === key))
    .filter((book): book is Record<string, unknown> => Boolean(book));

  async function choose(book: Record<string, unknown>) {
    if (saving) return;
    setSaving(true);
    const key = bookKey(book);
    const day = localDay();
    try {
      await updateLibrary((data) => ({ ...data, books: data.books.map((b) => (bookKey(b) === key ? setReadStatus(b, 1, day) : b)) }));
      onClose();
    } catch {
      toast({ message: "Couldn't save the status change.", kind: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet title="Pick your next read" onClose={onClose}>
      <div className="grid grid-cols-2 gap-4 px-3 pb-4">
        {pair.map((book) => (
          <div key={bookKey(book)} className="flex flex-col gap-2">
            <div className="aspect-[2/3] overflow-hidden rounded-md bg-(--color-border)"><CoverImage book={book} /></div>
            <p className="line-clamp-2 text-center text-sm">{String(book.Title ?? "Untitled")}</p>
            <DuelButton onClick={() => void choose(book)} disabled={saving}>This one</DuelButton>
          </div>
        ))}
      </div>
      {keys.length > 2 ? (
        <div className="px-3 pb-4">
          <button type="button" disabled={saving} onClick={() => setOffset((value) => value + 2)} className="min-h-11 w-full rounded-lg border border-(--color-border) px-3 py-2 text-sm font-semibold hover:bg-(--color-surface-hover) disabled:opacity-50">Another pair</button>
        </div>
      ) : null}
    </Sheet>
  );
}
```

Check how `useToast` is called elsewhere (`FinishSheet.tsx`, `LibraryPage.tsx`) and match its signature. Check the `CoverImage` export and props in `BookCard.tsx`.

- [ ] **Step 3: The link on Home**

In `HomePage.tsx`:
- Add `const [picking, setPicking] = useState(false);`.
- In the Up next branch, put a `Can't choose?` text button beside the `<h2>`, shown when `card.bookKeys.length >= 2`. Wrap the heading and button in a `flex items-baseline justify-between` row.
- Render `{picking ? <PickNextSheet keys={upNextKeys} books={books} onClose={() => setPicking(false)} /> : null}` after the sections, where `upNextKeys` is the Up next card's full `bookKeys`, found with `cards.find((c) => c.kind === "upNext")`.

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`
Expected: PASS, lint at the 16-warning baseline, none in touched files.

```bash
/usr/bin/git add frontend/src
/usr/bin/git commit -m "Web: Pick my next read from Up next"
```

---

### Task 3: Verification and device check

- [ ] **Step 1: Merge main and run everything**

```bash
/usr/bin/git fetch origin && /usr/bin/git merge --no-edit origin/main
npm run build --workspace @scripta/shared
npm test --workspace @scripta/shared
npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend
npm run typecheck --workspace mobile && npm test --workspace mobile
cd mobile && npx expo-doctor
```

- [ ] **Step 2: Device check (mobile)**

`node scripts/dev-status.mjs --json` once. An `emulator-5554` with no lease holder is adopted by `node scripts/dev-emulator.mjs`; that is not a second emulator. Skip only if another worktree holds a lease, all slots are taken, or `dev-emulator.mjs` refuses.

Change the dev account only through the app's UI. Never write the database directly. Put back what you change: set a picked book back to To read through its status control.

Check, with screenshots:
- **Link:** Home's Up next shows `Can't choose?`.
- **Sheet:** tapping it opens `Pick your next read` with two covers, titles and equal-height `This one` buttons, with nothing clipped at phone width.
- **Another pair:** it shows the next two books, and wraps around at the end.
- **Choosing:** `This one` closes the sheet, and the book appears under Reading now on Home.
- **Failed save:** stop only your own slot's backend, choose a book, and confirm the status alert shows and the sheet stays open. Restart the stack afterwards.

Run `npm run dev:release` at the end.

- [ ] **Step 3: Report**

List every check with pass/fail and counts, the screenshot paths, and the account state left.

---

## Self-review

- **Spec coverage:**
  - the entry link shown at two or more books: Tasks 1 and 2, Step 3;
  - the sheet, the two covers and the duel layout: Step 2 on both;
  - `Another pair` with wrap-around: Step 2 on both;
  - choosing through the existing status save: Step 2;
  - a failed save keeping the sheet open: Step 2, and Task 3;
  - no date, shelf update or event: Global Constraints;
  - no shared helper: the pairing is a single index expression on each client.
- **Types:** `DuelButton` differs per client (`onPress` on native, `onClick` on web), as each client's conventions do. `PickNextSheet`'s props are defined in each task.
