import { useCallback, useRef, useState } from "react";
import { Keyboard, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Text } from "../../../ui/Text";
import { Image } from "expo-image";
import { buildManualBook, normalizeIsbn, searchInsideOutside, searchResultByline, seriesLabel } from "@scripta/shared";
import { Button, Input } from "../../../ui/components";
import { useToast } from "../../../ui/ToastHost";
import { spacing, typography, useTheme } from "../../../ui/theme";
import { bookSearchApi, type BookSearchResult } from "../api/search";
import { IsbnScanner } from "./IsbnScanner";
import { SelectRow } from "./StyleControls";

const STATUS_OPTIONS = [
  { value: "2", label: "Finished" },
  { value: "1", label: "Reading" },
  { value: "0", label: "To read" },
];

export function AddBookForm({
  onAdd,
  onClose,
  initialQuery = "",
  initialScanning = false,
}: {
  onAdd: (book: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
  initialQuery?: string;
  initialScanning?: boolean;
}) {
  const { colors } = useTheme();
  const toast = useToast();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<BookSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [outsidePending, setOutsidePending] = useState(false);
  const [outsideFailed, setOutsideFailed] = useState(false);
  const searchRun = useRef(0);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(initialScanning);

  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [isbn, setIsbn] = useState("");
  const [publisher, setPublisher] = useState("");
  const [genres, setGenres] = useState<BookSearchResult["genres"]>([]);
  const [readStatus, setReadStatus] = useState("2");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => () => {
    searchRun.current++;
    setScanning(false);
    setSearching(false);
    setOutsidePending(false);
  }, []));

  function toggleScanner() {
    if (scanning) {
      setScanning(false);
      return;
    }
    Keyboard.dismiss();
    searchRun.current++;
    setSearching(false);
    setOutsidePending(false);
    setOutsideFailed(false);
    setSearchError(null);
    setResults(null);
    setScanning(true);
  }

  function selectResult(result: BookSearchResult) {
    setTitle(result.title);
    setAuthor(result.authors.join(", "));
    setIsbn(result.isbn ?? "");
    setPublisher(result.publisher ?? "");
    setGenres(result.genres);
    setResults(null);
    searchRun.current++;
    setSearching(false);
    setOutsidePending(false);
    setOutsideFailed(false);
  }

  async function runSearch(raw = query) {
    const q = raw.trim();
    if (!q) return;
    setScanning(false);
    const run = ++searchRun.current;
    setSearching(true);
    setSearchError(null);
    setResults(null);
    setOutsidePending(false);
    setOutsideFailed(false);
    try {
      await searchInsideOutside(q, bookSearchApi, (state) => {
        if (run !== searchRun.current) return;
        setSearching(false);
        setResults(state.results);
        setOutsidePending(state.outsidePending);
        setOutsideFailed(state.outsideFailed);
        if (!state.outsidePending && !state.outsideFailed && state.results.length === 1) selectResult(state.results[0]);
      });
    } catch (err) {
      if (run !== searchRun.current) return;
      setSearching(false);
      setSearchError(err instanceof Error ? err.message : "Search failed — try again.");
    }
  }

  async function handleSave() {
    if (!title.trim() || !author.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onAdd(
        buildManualBook(
          {
            title: title.trim(),
            author: author.trim(),
            isbn: normalizeIsbn(isbn),
            publisher: publisher.trim() || null,
            readStatus: Number(readStatus),
            rating: null,
            dateRead: null,
            genres,
          },
          `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        ),
      );
      setTitle("");
      setAuthor("");
      setIsbn("");
      setPublisher("");
      setGenres([]);
      setQuery("");
      toast.show("Added to your library", "success");
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't add that book.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}>
        <View style={styles.searchRow}>
          <View style={{ flex: 1 }}>
            <Input label="Search" placeholder="ISBN, title, or author" value={query} onChangeText={setQuery} onSubmitEditing={() => void runSearch()} autoCapitalize="none" autoCorrect={false} returnKeyType="search" />
          </View>
          <View style={styles.searchButton}>
            <Button label={searching ? "…" : "Search"} loading={searching} disabled={query.trim() === ""} onPress={() => void runSearch()} />
          </View>
        </View>
        {initialScanning ? <Button label={scanning ? "Stop scanning" : "Scan again"} variant="secondary" disabled={saving} onPress={toggleScanner} /> : null}
        {scanning && (
          <IsbnScanner
            hint="Point at the ISBN barcode on the back cover."
            onIsbn={(scannedIsbn) => {
              setQuery(scannedIsbn);
              setIsbn(scannedIsbn);
              setTitle("");
              setAuthor("");
              setPublisher("");
              setGenres([]);
              setSaveError(null);
              void runSearch(scannedIsbn);
            }}
          />
        )}
        {searchError && <Text style={[typography.caption, { color: colors.danger }]}>{searchError}</Text>}

        {results !== null && (
          <View style={{ gap: spacing.xs }}>
            {results.length === 0 && !outsidePending && <Text style={[typography.body, { color: colors.textDim }]}>No matches — fill the form in below by hand instead.</Text>}
            {results.map((r, i) => (
              <Pressable
                accessibilityRole="button"
                key={i}
                onPress={() => selectResult(r)}
                style={[styles.resultRow, { borderColor: colors.border }]}
              >
                {r.coverUrl ? (
                  <Image source={{ uri: r.coverUrl }} style={styles.resultCover} contentFit="cover" />
                ) : (
                  <View style={[styles.resultCover, { backgroundColor: colors.border }]} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[typography.body, { color: colors.text, fontWeight: "600" }]} numberOfLines={1}>
                    {r.title}
                  </Text>
                  {r.series && (
                    <Text style={[typography.caption, { color: colors.textDim }]} numberOfLines={1}>
                      {seriesLabel(r.series)}
                    </Text>
                  )}
                  <Text style={[typography.caption, { color: colors.textDim }]} numberOfLines={1}>
                    {searchResultByline(r)}
                  </Text>
                </View>
              </Pressable>
            ))}
            {outsidePending && <Text style={[typography.caption, { color: colors.textDim }]}>Searching Open Library…</Text>}
            {outsideFailed && <Text style={[typography.caption, { color: colors.textDim }]}>Couldn't reach Open Library</Text>}
          </View>
        )}

        <View style={{ gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md }}>
          <Input label="Title (required)" value={title} onChangeText={setTitle} />
          <Input label="Author (required)" value={author} onChangeText={setAuthor} />
          <Input label="ISBN" value={isbn} onChangeText={setIsbn} keyboardType="numeric" />
          <Input label="Publisher" value={publisher} onChangeText={setPublisher} />
          <SelectRow label="Status" value={readStatus} options={STATUS_OPTIONS} onChange={setReadStatus} />
          <Button label={saving ? "Adding…" : "Add book"} loading={saving} disabled={title.trim() === "" || author.trim() === ""} onPress={() => void handleSave()} />
          {title.trim() === "" || author.trim() === "" ? <Text style={[typography.caption, { color: colors.textDim }]}>Add a title and an author to continue.</Text> : null}
          {saveError && <Text style={[typography.caption, { color: colors.danger }]}>{saveError}</Text>}
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  searchRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  searchButton: { paddingBottom: 2 },
  resultRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderRadius: 8, padding: spacing.sm },
  resultCover: { width: 40, height: 58, borderRadius: 4 },
});
