// Mirrors frontend's components/AddBookModal.tsx, minus the barcode
// scanner (@zxing/browser is web-only and this app has no camera-scan
// dependency — see this task's handoff notes for that gap). Open Library
// search still works (../api/search.ts is a straight fetch port); typing
// or picking a search result both funnel into the same
// @scripta/shared buildManualBook record onAdd runs through the normal
// merge/order/save pipeline, same as the web version.

import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { buildManualBook, normalizeIsbn } from "@scripta/shared";
import { Button, Input } from "../../../ui/components";
import { spacing, typography, useTheme } from "../../../ui/theme";
import { searchBooks, type BookSearchResult } from "../api/search";
import { SelectRow } from "./StyleControls";

const STATUS_OPTIONS = [
  { value: "2", label: "Finished" },
  { value: "1", label: "Reading" },
  { value: "0", label: "Not read" },
];

export function AddBookForm({
  onAdd,
  onClose,
}: {
  onAdd: (book: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BookSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [isbn, setIsbn] = useState("");
  const [publisher, setPublisher] = useState("");
  const [readStatus, setReadStatus] = useState("2");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function selectResult(result: BookSearchResult) {
    setTitle(result.title);
    setAuthor(result.authors.join(", "));
    setIsbn(result.isbn ?? "");
    setPublisher(result.publisher ?? "");
    setResults(null);
  }

  async function runSearch() {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    setResults(null);
    try {
      const found = await searchBooks(q);
      setResults(found);
      if (found.length === 1) selectResult(found[0]);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed — try again.");
    } finally {
      setSearching(false);
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
          },
          `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        ),
      );
      setTitle("");
      setAuthor("");
      setIsbn("");
      setPublisher("");
      setQuery("");
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
            <Input label="Search" placeholder="ISBN, title, or author" value={query} onChangeText={setQuery} onSubmitEditing={() => void runSearch()} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" returnKeyType="search" />
          </View>
          <View style={styles.searchButton}>
            <Button label={searching ? "…" : "Search"} loading={searching} disabled={query.trim() === ""} onPress={() => void runSearch()} />
          </View>
        </View>
        {searchError && <Text style={[typography.caption, { color: colors.danger }]}>{searchError}</Text>}

        {results !== null && (
          <View style={{ gap: spacing.xs }}>
            {results.length === 0 && <Text style={[typography.body, { color: colors.textDim }]}>No matches — fill the form in below by hand instead.</Text>}
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
                  <Text style={[typography.caption, { color: colors.textDim }]} numberOfLines={1}>
                    {[r.authors.join(", "), r.year].filter(Boolean).join(" · ")}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}

        <View style={{ gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md }}>
          <Input label="Title" value={title} onChangeText={setTitle} />
          <Input label="Author" value={author} onChangeText={setAuthor} />
          <Input label="ISBN" value={isbn} onChangeText={setIsbn} keyboardType="numeric" />
          <Input label="Publisher" value={publisher} onChangeText={setPublisher} />
          <SelectRow label="Status" value={readStatus} options={STATUS_OPTIONS} onChange={setReadStatus} />
          <Button label={saving ? "Adding…" : "Add book"} loading={saving} disabled={title.trim() === "" || author.trim() === ""} onPress={() => void handleSave()} />
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
