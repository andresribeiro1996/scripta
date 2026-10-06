import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Keyboard, Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useFocusEffect } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { Text } from "../../../ui/Text";
import { Image } from "expo-image";
import { buildManualBook, normalizeIsbn, searchInsideOutside } from "@scripta/shared";
import { Button, Input } from "../../../ui/components";
import { radii, spacing, typography, useTheme } from "../../../ui/theme";
import { bookSearchApi, type BookSearchResult } from "../api/search";
import { isbnFromBarcode } from "../lib/isbnBarcode";
import { SelectRow } from "./StyleControls";

const STATUS_OPTIONS = [
  { value: "2", label: "Finished" },
  { value: "1", label: "Reading" },
  { value: "0", label: "To read" },
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
  const [outsidePending, setOutsidePending] = useState(false);
  const [outsideFailed, setOutsideFailed] = useState(false);
  const searchRun = useRef(0);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [requestingCamera, setRequestingCamera] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const scanRun = useRef(0);
  const scanConsumed = useRef(true);
  const focused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState === "active");

  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [isbn, setIsbn] = useState("");
  const [publisher, setPublisher] = useState("");
  const [genres, setGenres] = useState<BookSearchResult["genres"]>([]);
  const [readStatus, setReadStatus] = useState("2");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => () => {
    scanRun.current++;
    searchRun.current++;
    scanConsumed.current = true;
    setScanning(false);
    setRequestingCamera(false);
    setSearching(false);
    setOutsidePending(false);
  }, []));

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setAppActive(state === "active");
      if (state === "background") {
        scanRun.current++;
        scanConsumed.current = true;
        setScanning(false);
        setRequestingCamera(false);
      }
    });
    return () => subscription.remove();
  }, []);

  async function toggleScanner() {
    const run = ++scanRun.current;
    setScanError(null);
    if (scanning) {
      scanConsumed.current = true;
      setScanning(false);
      return;
    }
    setRequestingCamera(true);
    try {
      const response = permission?.granted ? permission : await requestPermission();
      if (run !== scanRun.current) return;
      if (!response.granted) {
        setScanError(response.canAskAgain
          ? "Allow camera access to scan a book, or type the ISBN instead."
          : "Camera access is disabled. Enable it in Settings, or type the ISBN instead.");
        return;
      }
      Keyboard.dismiss();
      searchRun.current++;
      setSearching(false);
      setOutsidePending(false);
      setOutsideFailed(false);
      setSearchError(null);
      setResults(null);
      scanConsumed.current = false;
      setScanning(true);
    } catch (err) {
      if (run === scanRun.current) setScanError(err instanceof Error ? err.message : "Couldn't access the camera. Type the ISBN instead.");
    } finally {
      if (run === scanRun.current) setRequestingCamera(false);
    }
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
    scanConsumed.current = true;
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
        <Button label={scanning ? "Stop scanning" : "Scan ISBN with camera"} variant="secondary" loading={requestingCamera} disabled={saving} onPress={() => void toggleScanner()} />
        {scanError && <Text selectable accessibilityRole="alert" style={[typography.caption, { color: colors.danger }]}>{scanError}</Text>}
        {scanError && permission && !permission.granted && !permission.canAskAgain && (
          <Button label="Open Settings" variant="secondary" onPress={() => {
            void Linking.openSettings().catch((err: unknown) => setScanError(err instanceof Error ? err.message : "Couldn't open Settings."));
          }} />
        )}
        {scanning && focused && appActive && (
          <View style={{ gap: spacing.sm }}>
            <View style={{ aspectRatio: 4 / 3, borderRadius: radii.lg, overflow: "hidden", backgroundColor: colors.surface }}>
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ["ean13", "code128"] }}
                onBarcodeScanned={({ data }) => {
                  if (scanConsumed.current || AppState.currentState !== "active") return;
                  const scannedIsbn = isbnFromBarcode(data);
                  if (!scannedIsbn) return;
                  scanConsumed.current = true;
                  setQuery(scannedIsbn);
                  setIsbn(scannedIsbn);
                  setTitle("");
                  setAuthor("");
                  setPublisher("");
                  setGenres([]);
                  setSaveError(null);
                  void runSearch(scannedIsbn);
                }}
                onMountError={({ message }) => {
                  scanConsumed.current = true;
                  setScanning(false);
                  setScanError(message || "Couldn't start the camera. Type the ISBN instead.");
                }}
              />
            </View>
            <Text style={[typography.caption, { color: colors.textDim }]}>Point at the ISBN barcode on the back cover.</Text>
          </View>
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
                  <Text style={[typography.caption, { color: colors.textDim }]} numberOfLines={1}>
                    {[r.authors.join(", "), r.year].filter(Boolean).join(" · ")}
                  </Text>
                </View>
              </Pressable>
            ))}
            {outsidePending && <Text style={[typography.caption, { color: colors.textDim }]}>Searching Open Library…</Text>}
            {outsideFailed && <Text style={[typography.caption, { color: colors.textDim }]}>Couldn't reach Open Library</Text>}
          </View>
        )}

        <View style={{ gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md }}>
          <Input label="Title" value={title} onChangeText={setTitle} />
          <Input label="Author" value={author} onChangeText={setAuthor} />
          <Input label="ISBN" value={isbn} onChangeText={setIsbn} keyboardType="numeric" />
          <Input label="Publisher" value={publisher} onChangeText={setPublisher} />
          <SelectRow label="Status" value={readStatus} options={STATUS_OPTIONS} onChange={setReadStatus} />
          <Button label={saving ? "Adding…" : "Add book"} loading={saving} disabled={scanning || requestingCamera || title.trim() === "" || author.trim() === ""} onPress={() => void handleSave()} />
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
