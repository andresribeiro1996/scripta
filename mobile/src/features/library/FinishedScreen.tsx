import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
  bookKey,
  favouriteOpponent,
  formatFinishDay,
  localDay,
  promoteFavourite,
  shelfAfterFinish,
  type FinishRating,
  type MuralBlock,
  type ReadSnapshot,
} from "@scripta/shared";
import { fetchOwnProfile } from "../community/api";
import { fetchMural } from "../murals/api";
import { useMurals } from "../murals/useMurals";
import { Button, Input, Toast } from "../../ui/components";
import { dynamicType, spacing, typography, useTheme } from "../../ui/theme";
import { CoverImage } from "./components/CoverImage";
import { FeelingChips } from "./components/FeelingChips";
import { useLibrary } from "./hooks/useLibrary";
import { useLibraryActions } from "./hooks/useLibraryActions";

type Shelf = { id: string; original: MuralBlock[]; blocks: MuralBlock[] };

export function FinishedScreen({ book, before, onClose }: { book: Record<string, unknown>; before: ReadSnapshot; onClose: () => void }) {
  const { colors } = useTheme();
  const { setRating, addNote, restoreRead } = useLibraryActions();
  const libraryQuery = useLibrary();
  const queryClient = useQueryClient();
  const murals = useMurals();
  const own = useQuery({ queryKey: ["community", "own-profile"], queryFn: fetchOwnProfile });

  const key = bookKey(book);
  const [savedRating, setSavedRating] = useState(false);
  const [note, setNote] = useState("");
  const noteRef = useRef("");
  const settled = useRef(false);

  const [shelf, setShelf] = useState<Shelf | null>(null);
  const [landed, setLanded] = useState<Array<"finished" | "favourites">>([]);
  const [shelfError, setShelfError] = useState<string | null>(null);
  const [favouriteChoiceMade, setFavouriteChoiceMade] = useState(false);
  const startedShelfUpdate = useRef(false);

  async function saveShelf(id: string, blocks: MuralBlock[]) {
    try {
      await murals.update(id, { blocks });
      await queryClient.invalidateQueries({ queryKey: ["murals", id] });
    } catch {
      setShelfError("Couldn't update your shelf.");
    }
  }

  async function updateShelf(rating: number | null) {
    const muralId = own.data?.muralId;
    if (!muralId) return;
    try {
      const current: Shelf = shelf ?? {
        id: muralId,
        original: (await queryClient.fetchQuery({ queryKey: ["murals", muralId], queryFn: () => fetchMural(muralId) })).blocks,
        blocks: [],
      };
      const base = shelf ? shelf.blocks : current.original;
      const result = shelfAfterFinish(base, key, rating);
      setLanded((prev) => [...new Set([...prev, ...result.landed])]);
      setShelf({ ...current, blocks: result.blocks });
      if (result.blocks !== base) await saveShelf(muralId, result.blocks);
    } catch {
      setShelfError("Couldn't update your shelf.");
    }
  }

  useEffect(() => {
    if (!own.data?.muralId || startedShelfUpdate.current) return;
    startedShelfUpdate.current = true;
    void updateShelf(typeof book.Rating === "number" ? book.Rating : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [own.data?.muralId]);

  function finish() {
    if (settled.current) return;
    settled.current = true;
    const text = noteRef.current.trim();
    if (text) void addNote(book, text);
  }
  useEffect(() => finish, []);

  async function handleRatingChange(rating: FinishRating) {
    setSavedRating(false);
    const ok = await setRating(book, rating);
    if (ok) {
      setSavedRating(true);
      void updateShelf(rating);
    }
  }

  async function chooseThisOne() {
    if (!shelf) return;
    const nextBlocks = promoteFavourite(shelf.blocks, key);
    setFavouriteChoiceMade(true);
    if (nextBlocks !== shelf.blocks) {
      setShelf({ ...shelf, blocks: nextBlocks });
      await saveShelf(shelf.id, nextBlocks);
    }
  }

  function handleDone() {
    finish();
    onClose();
  }

  async function undo() {
    settled.current = true;
    const restored = await restoreRead(book, before);
    if (shelf && shelf.blocks !== shelf.original) await saveShelf(shelf.id, shelf.original);
    if (restored) onClose();
  }

  const opponentKey = shelf ? favouriteOpponent(shelf.blocks, key) : null;
  const opponentBook = opponentKey
    ? (libraryQuery.data?.data.books ?? []).find((candidate) => bookKey(candidate) === opponentKey) ?? null
    : null;

  const day = formatFinishDay(String(book.DateLastRead ?? localDay()));
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
              <Button label="This one" variant="secondary" onPress={() => void chooseThisOne()} />
            </View>
            <View style={styles.opponentItem}>
              <View style={[styles.opponentCover, { backgroundColor: colors.border }]}>
                <CoverImage book={opponentBook} />
              </View>
              <Button label={`Still ${String(opponentBook.Title ?? "this one")}`} variant="secondary" onPress={() => setFavouriteChoiceMade(true)} />
            </View>
          </View>
        </View>
      ) : null}

      {footer ? <Text style={[typography.body, { color: colors.textDim }]}>{footer}</Text> : null}

      <Button label="Not finished? Undo" variant="secondary" onPress={() => void undo()} />
    </ScrollView>
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
});
