import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  bookKey,
  createShelfSession,
  favouriteOpponent,
  formatFinishDay,
  localDay,
  type FinishRating,
  type Landing,
  type Mural,
  type MuralBlock,
  type ReadSnapshot,
  type ShelfSession,
} from "@scripta/shared";
import { fetchOwnProfile } from "../community/api";
import { fetchMural, updateMural } from "../murals/api";
import { Button, Input, Toast } from "../../ui/components";
import { dynamicType, radii, spacing, typography, useTheme } from "../../ui/theme";
import { CoverImage } from "./components/CoverImage";
import { FeelingChips } from "./components/FeelingChips";
import { useLibrary } from "./hooks/useLibrary";
import { useLibraryActions } from "./hooks/useLibraryActions";

type Shelf = { blocks: MuralBlock[]; landed: Landing[] };

export function FinishedScreen({ book, before, onClose }: { book: Record<string, unknown>; before: ReadSnapshot | null; onClose: () => void }) {
  const { colors } = useTheme();
  const { setRating, addNote, restoreRead } = useLibraryActions();
  const libraryQuery = useLibrary();
  const queryClient = useQueryClient();
  const own = useQuery({ queryKey: ["community", "own-profile"], queryFn: fetchOwnProfile });

  const key = bookKey(book);
  const [savedRating, setSavedRating] = useState(false);
  const [note, setNote] = useState("");
  const noteRef = useRef("");
  const settled = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const sessionRef = useRef<ShelfSession | null>(null);
  const startedShelfUpdate = useRef(false);
  const [shelf, setShelf] = useState<Shelf | null>(null);
  const [shelfError, setShelfError] = useState<string | null>(null);
  const [favouriteChoiceMade, setFavouriteChoiceMade] = useState(false);

  // While the sheet is still open the in-sheet banner is enough; a save that
  // fails after Done/Undo already closed it (a queued finish/promote settling
  // late) has no banner left to show it, so that case also gets an Alert.
  function reportShelfError() {
    if (mounted.current) setShelfError("Couldn't update your shelf.");
    else Alert.alert("Couldn't update your shelf.");
  }

  useEffect(() => {
    const muralId = own.data?.muralId;
    if (!muralId || startedShelfUpdate.current) return;
    startedShelfUpdate.current = true;
    const session = createShelfSession({
      load: async () => {
        const mural = await fetchMural(muralId);
        return { id: mural.id, blocks: mural.blocks, updatedAt: mural.updatedAt };
      },
      save: async (id, blocks, updatedAt) => {
        const updated = await updateMural(id, { blocks, updatedAt });
        queryClient.setQueryData<Mural[]>(["murals"], (list) => list?.map((m) => (m.id === id ? updated : m)));
        return updated;
      },
      onChange: (state) => { if (mounted.current) setShelf(state); },
    });
    sessionRef.current = session;
    void session.finish(key, typeof book.Rating === "number" ? book.Rating : null).catch(reportShelfError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [own.data?.muralId]);

  useEffect(() => () => sessionRef.current?.stop(), []);

  function finish() {
    const text = noteRef.current.trim();
    if (settled.current || !text) return;
    settled.current = true;
    void addNote(book, text);
  }
  useEffect(() => finish, []);

  async function handleRatingChange(rating: FinishRating) {
    setSavedRating(false);
    const ok = await setRating(book, rating);
    if (ok) {
      setSavedRating(true);
      sessionRef.current?.finish(key, rating).catch(reportShelfError);
    }
  }

  async function chooseThisOne() {
    setFavouriteChoiceMade(true);
    try {
      await sessionRef.current?.promote(key);
    } catch {
      reportShelfError();
    }
  }

  function handleDone() {
    finish();
    onClose();
  }

  async function undo(snapshot: ReadSnapshot) {
    settled.current = true;
    const ok = await restoreRead(book, snapshot);
    if (!ok) {
      settled.current = false;
      return;
    }
    const shelfOk = (await sessionRef.current?.restore()) ?? true;
    if (!shelfOk) {
      setShelfError("Couldn't update your shelf.");
      return;
    }
    onClose();
  }

  const opponentKey = shelf ? favouriteOpponent(shelf.blocks, key) : null;
  const opponentBook = opponentKey
    ? (libraryQuery.data?.data.books ?? []).find((candidate) => bookKey(candidate) === opponentKey) ?? null
    : null;

  const day = formatFinishDay(typeof book.DateLastRead === "string" ? book.DateLastRead : localDay());
  const landed = shelf?.landed ?? [];
  const footer = landed.length === 0
    ? null
    : landed.includes("favourites")
      ? "Added to Finished on your shelf, and to Favourites"
      : "Added to Finished on your shelf";

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {shelfError ? <Toast visible message={shelfError} tone="error" /> : null}

      <View style={styles.header}>
        <Text {...dynamicType} style={[typography.caption, styles.eyebrow, { color: colors.textDim }]}>{`Finished · ${day}`}</Text>
        <Button label="Done" onPress={handleDone} />
      </View>

      <View style={styles.bookRow}>
        <View style={[styles.cover, { backgroundColor: colors.border }]}>
          <CoverImage book={book} />
        </View>
        <View style={styles.bookText}>
          <Text style={[typography.heading, { color: colors.text }]} numberOfLines={2}>{String(book.Title ?? "Untitled")}</Text>
          <Text style={[typography.body, { color: colors.textDim, marginTop: 2 }]}>{String(book.Attribution ?? "Unknown author")}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[typography.title, { color: colors.text }]}>How did it land?</Text>
        <FeelingChips value={typeof book.Rating === "number" ? book.Rating : null} onChange={(rating) => void handleRatingChange(rating)} />
        {savedRating ? <Text style={[typography.caption, { color: colors.textDim }]}>Saved as your rating</Text> : null}
      </View>

      <View style={styles.section}>
        <Text style={[typography.title, { color: colors.text }]}>A thought to keep.</Text>
        <Input
          multiline
          numberOfLines={4}
          value={note}
          onChangeText={(text) => { setNote(text); noteRef.current = text; }}
          placeholder="What stuck with you?"
          accessibilityLabel="A thought to keep"
          style={{ minHeight: 96, textAlignVertical: "top" }}
        />
      </View>

      {opponentBook && !favouriteChoiceMade ? (
        <View style={styles.section}>
          <Text style={[typography.title, { color: colors.text }]}>Against your favourite.</Text>
          <View style={styles.opponentRow}>
            <View style={styles.opponentItem}>
              <View style={[styles.opponentCover, { backgroundColor: colors.border }]}>
                <CoverImage book={book} />
              </View>
              <DuelButton label="This one" onPress={() => void chooseThisOne()} />
            </View>
            <View style={styles.opponentItem}>
              <View style={[styles.opponentCover, { backgroundColor: colors.border }]}>
                <CoverImage book={opponentBook} />
              </View>
              <DuelButton label={`Still ${String(opponentBook.Title ?? "this one")}`} onPress={() => setFavouriteChoiceMade(true)} />
            </View>
          </View>
        </View>
      ) : null}

      {footer ? <Text style={[typography.body, { color: colors.textDim }]}>{footer}</Text> : null}

      {before && <Button label="Not finished? Undo" variant="secondary" onPress={() => void undo(before)} />}
    </ScrollView>
  );
}

// Not the shared Button — that one sizes to its text, so "This one" (one
// line) and "Still <a long title>" (up to two) would render at different
// heights side by side. A fixed two-line-tall box with a clamped label
// keeps both halves of the duel the same size regardless of content.
function DuelButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.duelButton,
        { borderColor: colors.border, backgroundColor: pressed ? colors.surfacePressed : colors.surface },
      ]}
    >
      <Text {...dynamicType} numberOfLines={2} style={[typography.body, styles.duelButtonText, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingBottom: spacing.xl },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  eyebrow: { textTransform: "uppercase", letterSpacing: 0.8, fontWeight: "600", flexShrink: 1 },
  bookRow: { flexDirection: "row", gap: spacing.lg },
  cover: { width: 96, aspectRatio: 2 / 3, borderRadius: 8, overflow: "hidden" },
  bookText: { flex: 1, justifyContent: "center" },
  section: { gap: spacing.sm },
  opponentRow: { flexDirection: "row", gap: spacing.lg },
  opponentItem: { flex: 1, gap: spacing.sm },
  opponentCover: { width: "100%", aspectRatio: 2 / 3, borderRadius: 8, overflow: "hidden" },
  duelButton: { minHeight: 64, borderWidth: 1, borderRadius: radii.md, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md },
  duelButtonText: { fontWeight: "600", textAlign: "center" },
});
