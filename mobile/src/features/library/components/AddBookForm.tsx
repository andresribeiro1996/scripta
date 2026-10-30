import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import {
  BOOK_FORMATS,
  buildManualBook,
  coverQueryKey,
  normalizeIsbn,
  searchInsideOutside,
  searchResultByline,
  seriesLabel,
  type BookFormat,
  type BookGenre,
} from "@scripta/shared";
import { Text } from "../../../ui/Text";
import { Button, FormScroll, IconButton, Input, Sheet } from "../../../ui/components";
import { Icon, type IconName } from "../../../ui/icon";
import { useToast } from "../../../ui/ToastHost";
import { radii, spacing, typography, useTheme } from "../../../ui/theme";
import { deleteGalleryImage, uploadGalleryImage } from "../../gallery/api";
import { bookSearchApi, type BookSearchResult } from "../api/search";
import type { ResolveCoverParams } from "../api/covers";
import {
  coverAfterResult,
  coverStatusLabel,
  parsePages,
  replacedUpload,
  uploadToDeleteOnExit,
  withDraftCover,
  type DraftCover,
} from "../lib/addBookDraft";
import { FoundCovers } from "./FoundCovers";
import { GenreChoices } from "./GenreChoices";
import { IsbnScanner } from "./IsbnScanner";
import { Chip } from "./StyleControls";

const FORMAT_CHIPS: Record<BookFormat, { label: string; icon: IconName }> = {
  hardcopy: { label: "Hardcopy", icon: "book" },
  ebook: { label: "Ebook", icon: "ebook" },
  audiobook: { label: "Audiobook", icon: "audiobook" },
  other: { label: "Other", icon: "otherFormat" },
};

const STATUS_OPTIONS = [
  { value: 1, label: "Reading" },
  { value: 0, label: "To read" },
  { value: 2, label: "Finished" },
];

const UPLOAD_CLEANUP_FAILED = "Couldn't remove the uploaded photo from your gallery.";
const REPLACED_CLEANUP_FAILED = "Couldn't remove the replaced photo from your gallery.";

function draftCoverUrl(cover: DraftCover): string | null {
  switch (cover.kind) {
    case "none": return null;
    case "upload": return cover.image.url;
    default: return cover.url;
  }
}

function FieldLabel({ children }: { children: string }) {
  const { colors } = useTheme();
  return <Text style={[typography.body, styles.fieldLabel, { color: colors.text }]}>{children}</Text>;
}

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
  const insets = useSafeAreaInsets();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const mounted = useRef(true);
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<BookSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [outsidePending, setOutsidePending] = useState(false);
  const [outsideFailed, setOutsideFailed] = useState(false);
  const searchRun = useRef(0);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(initialScanning);
  const [searchOpen, setSearchOpen] = useState(true);
  const [filledFrom, setFilledFrom] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [isbn, setIsbn] = useState("");
  const [publisher, setPublisher] = useState("");
  const [pagesText, setPagesText] = useState("");
  const [genres, setGenres] = useState<BookGenre[]>([]);
  const [genresEdited, setGenresEdited] = useState(false);
  const [genresOpen, setGenresOpen] = useState(false);
  const [format, setFormat] = useState<BookFormat>("hardcopy");
  const [readStatus, setReadStatus] = useState(1);
  const [moreOpen, setMoreOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [cover, setCoverState] = useState<DraftCover>({ kind: "none" });
  const coverRef = useRef<DraftCover>({ kind: "none" });
  const pendingSave = useRef<Promise<boolean> | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [coverLookup, setCoverLookup] = useState<ResolveCoverParams | null>(null);

  useFocusEffect(useCallback(() => () => {
    searchRun.current++;
    setScanning(false);
    setSearching(false);
    setOutsidePending(false);
  }, []));

  function removeUpload(imageId: string, failure: string) {
    deleteGalleryImage(imageId).catch(() => toastRef.current.show(failure, "error"));
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      uploadToDeleteOnExit(coverRef.current, pendingSave.current).then((imageId) => {
        if (imageId) removeUpload(imageId, UPLOAD_CLEANUP_FAILED);
      });
    };
  }, []);

  function setCover(next: DraftCover) {
    const replaced = replacedUpload(coverRef.current, next);
    coverRef.current = next;
    setCoverState(next);
    if (replaced) removeUpload(replaced, REPLACED_CLEANUP_FAILED);
  }

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
    setSearchOpen(true);
    setScanning(true);
  }

  function selectResult(result: BookSearchResult) {
    setTitle(result.title);
    setAuthor(result.authors.join(", "));
    setIsbn(result.isbn ?? "");
    setPublisher(result.publisher ?? "");
    setPagesText(result.pages ? String(result.pages) : "");
    setGenres(result.genres);
    setGenresEdited(false);
    setCover(coverAfterResult(coverRef.current, result.coverUrl));
    setFilledFrom(result.title);
    setSearchOpen(false);
    setScanning(false);
    searchRun.current++;
    setSearching(false);
    setOutsidePending(false);
    setOutsideFailed(false);
  }

  function handleScanned(scannedIsbn: string) {
    setQuery(scannedIsbn);
    setIsbn(scannedIsbn);
    setMoreOpen(true);
    setTitle("");
    setAuthor("");
    setPublisher("");
    setPagesText("");
    setGenres([]);
    setGenresEdited(false);
    setCover(coverAfterResult(coverRef.current, null));
    setFilledFrom(null);
    setSaveError(null);
    void runSearch(scannedIsbn);
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

  function openCoverSearch() {
    setCoverLookup({
      isbn: normalizeIsbn(isbn) || undefined,
      title: title.trim() || undefined,
      author: author.trim() || undefined,
    });
  }

  async function handleUpload() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setUploadError("Photo library access is off — enable it in Settings to upload a cover.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setUploadError(null);
    setUploading(true);
    try {
      const image = await uploadGalleryImage({
        uri: asset.uri,
        name: asset.fileName ?? `cover-${Date.now()}.jpg`,
        mimeType: asset.mimeType ?? "image/jpeg",
      });
      if (mounted.current) setCover({ kind: "upload", image });
      else removeUpload(image.id, UPLOAD_CLEANUP_FAILED);
    } catch (err) {
      if (mounted.current) setUploadError(err instanceof Error ? err.message : "Couldn't upload that image.");
    } finally {
      if (mounted.current) setUploading(false);
    }
  }

  function changeGenres(next: BookGenre[]) {
    setGenres(next);
    setGenresEdited(true);
  }

  async function handleSave() {
    if (!title.trim() || !author.trim()) return;
    setSaving(true);
    setSaveError(null);
    const attempt = onAdd(
      withDraftCover(
        buildManualBook(
          {
            title: title.trim(),
            author: author.trim(),
            isbn: normalizeIsbn(isbn),
            publisher: publisher.trim() || null,
            readStatus,
            rating: null,
            dateRead: null,
            format,
            pages: parsePages(pagesText),
            genres,
            genresEdited,
          },
          `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        ),
        coverRef.current,
      ),
    );
    pendingSave.current = attempt.then(() => true, () => false);
    try {
      await attempt;
      toast.show("Added to your library", "success");
      if (mounted.current) onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't add that book.");
    } finally {
      setSaving(false);
    }
  }

  const coverUrl = draftCoverUrl(cover);
  const canFindCover = title.trim() !== "" || isbn.trim() !== "";
  const canSave = title.trim() !== "" && author.trim() !== "" && !uploading;

  return (
    <View style={styles.root}>
      <FormScroll contentContainerStyle={styles.content}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={filledFrom ? `Search for a book, filled from ${filledFrom}` : "Search for a book"}
            accessibilityState={{ expanded: searchOpen }}
            onPress={() => setSearchOpen((open) => !open)}
            style={styles.cardHeader}
          >
            <Icon name="search" size={20} color={colors.accent} />
            <View style={styles.cardHeaderText}>
              <Text style={[typography.body, { color: colors.text, fontWeight: "600" }]}>Search for a book</Text>
              <Text numberOfLines={1} style={[typography.caption, { color: colors.accent }]}>
                {filledFrom ? `Filled from “${filledFrom}” · tap to search again` : "Auto-fill title, author, pages & cover"}
              </Text>
            </View>
            <View style={searchOpen ? styles.chevronOpen : null}>
              <Icon name="chevronDown" size={20} color={colors.textDim} />
            </View>
          </Pressable>
          {searchOpen ? (
            <View style={[styles.cardBody, { borderTopColor: colors.border }]}>
              <View style={styles.searchRow}>
                <View style={styles.grow}>
                  <Input
                    accessibilityLabel="Title, author or ISBN"
                    placeholder="Title, author or ISBN"
                    value={query}
                    onChangeText={setQuery}
                    onSubmitEditing={() => void runSearch()}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                  />
                </View>
                <IconButton name="scan" framed accessibilityLabel={scanning ? "Stop scanning" : "Scan barcode"} disabled={saving} onPress={toggleScanner} />
                <IconButton name="search" framed tone="accent" accessibilityLabel="Search" disabled={searching || query.trim() === ""} onPress={() => void runSearch()} />
              </View>
              {scanning ? <IsbnScanner hint="Point at the ISBN barcode on the back cover." onIsbn={handleScanned} /> : null}
              {searchError ? <Text style={[typography.caption, { color: colors.danger }]}>{searchError}</Text> : null}
              {results !== null && results.length > 0 ? <Text style={[typography.caption, { color: colors.textDim }]}>Tap a result to fill the form</Text> : null}
              {results !== null ? (
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
                      <View style={styles.grow}>
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
                      <Icon name="chevronRight" size={18} color={colors.textDim} />
                    </Pressable>
                  ))}
                  {outsidePending && <Text style={[typography.caption, { color: colors.textDim }]}>Searching Open Library…</Text>}
                  {outsideFailed && <Text style={[typography.caption, { color: colors.textDim }]}>Couldn't reach Open Library</Text>}
                </View>
              ) : null}
            </View>
          ) : null}
        </View>

        <View style={styles.coverRow}>
          <View style={[styles.cover, { backgroundColor: colors.accentSoft, borderColor: colors.border }]}>
            {coverUrl ? (
              <Image accessibilityLabel="Cover preview" source={{ uri: coverUrl }} style={styles.coverImage} contentFit="cover" />
            ) : (
              <Icon name="book" size={28} color={colors.accent} />
            )}
          </View>
          <View style={styles.coverSide}>
            <Text style={[typography.body, { color: colors.text, fontWeight: "600" }]}>Cover image</Text>
            <Text style={[typography.caption, { color: colors.textDim }]}>{coverStatusLabel(cover)}</Text>
            <View style={styles.coverButtons}>
              <View style={styles.grow}>
                <Button label="Find cover" variant="secondary" disabled={!canFindCover || saving} onPress={openCoverSearch} />
              </View>
              <View style={styles.grow}>
                <Button label={uploading ? "Uploading…" : "Upload"} variant="secondary" loading={uploading} disabled={saving} onPress={() => void handleUpload()} />
              </View>
            </View>
            {!canFindCover ? <Text style={[typography.caption, { color: colors.textDim }]}>Add a title or ISBN to find a cover.</Text> : null}
            {uploadError ? <Text style={[typography.caption, { color: colors.danger }]}>{uploadError}</Text> : null}
          </View>
        </View>

        <Input label="Title *" accessibilityLabel="Title (required)" placeholder="e.g. The Hobbit" value={title} onChangeText={setTitle} />
        <Input label="Author *" accessibilityLabel="Author (required)" placeholder="e.g. J.R.R. Tolkien" value={author} onChangeText={setAuthor} />

        <View style={styles.group}>
          <FieldLabel>Format</FieldLabel>
          <View style={styles.chips}>
            {BOOK_FORMATS.map((value) => (
              <Chip key={value} label={FORMAT_CHIPS[value].label} icon={FORMAT_CHIPS[value].icon} selected={format === value} onPress={() => setFormat(value)} />
            ))}
          </View>
        </View>

        <Input label="Total pages" placeholder="e.g. 310" value={pagesText} onChangeText={setPagesText} keyboardType="number-pad" maxLength={5} />

        <View style={styles.group}>
          <FieldLabel>Genre (optional)</FieldLabel>
          <View style={styles.chips}>
            {genres.map((genre) => (
              <Chip key={genre} label={genre} selected onPress={() => changeGenres(genres.filter((item) => item !== genre))} />
            ))}
            <Chip label={genresOpen ? "Done" : "+ Add"} selected={genresOpen} onPress={() => setGenresOpen((open) => !open)} />
          </View>
          {genresOpen ? <GenreChoices value={genres} onChange={changeGenres} /> : null}
        </View>

        <View style={styles.group}>
          <FieldLabel>Add as</FieldLabel>
          <View style={styles.statusRow}>
            {STATUS_OPTIONS.map((option) => (
              <Chip key={option.value} grow label={option.label} selected={readStatus === option.value} onPress={() => setReadStatus(option.value)} />
            ))}
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="More details"
            accessibilityState={{ expanded: moreOpen }}
            onPress={() => setMoreOpen((open) => !open)}
            style={styles.cardHeader}
          >
            <Text style={[typography.body, styles.grow, { color: colors.textDim }]}>More details · ISBN, publisher</Text>
            <View style={moreOpen ? styles.chevronOpen : null}>
              <Icon name="chevronDown" size={20} color={colors.textDim} />
            </View>
          </Pressable>
          {moreOpen ? (
            <View style={[styles.cardBody, { borderTopColor: colors.border }]}>
              <Input label="ISBN" value={isbn} onChangeText={setIsbn} keyboardType="numeric" />
              <Input label="Publisher" value={publisher} onChangeText={setPublisher} />
            </View>
          ) : null}
        </View>
      </FormScroll>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        {saveError ? <Text style={[typography.caption, { color: colors.danger }]}>{saveError}</Text> : null}
        <Button label={saving ? "Adding…" : "Add to library"} loading={saving} disabled={!canSave} onPress={() => void handleSave()} />
      </View>

      <Sheet visible={coverLookup !== null} title="Find a cover" onClose={() => setCoverLookup(null)}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}>
          {coverLookup ? (
            <FoundCovers
              key={coverQueryKey(coverLookup)}
              lookup={coverLookup}
              coverUrl={coverUrl}
              onPick={(picked) => {
                if (!picked.fullUrl) return;
                setCover({ kind: "found", url: picked.fullUrl });
                setCoverLookup(null);
              }}
            />
          ) : null}
        </ScrollView>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  grow: { flex: 1 },
  content: { gap: spacing.md, paddingBottom: spacing.lg },
  card: { borderWidth: 1, borderRadius: radii.xl },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  cardHeaderText: { flex: 1 },
  chevronOpen: { transform: [{ rotate: "180deg" }] },
  cardBody: { gap: spacing.sm, padding: spacing.md, borderTopWidth: 1 },
  searchRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  resultRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderRadius: radii.md, padding: spacing.sm },
  resultCover: { width: 40, height: 58, borderRadius: 4 },
  coverRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  cover: { width: 84, height: 126, borderRadius: radii.lg, borderWidth: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  coverImage: { width: "100%", height: "100%" },
  coverSide: { flex: 1, gap: spacing.xs },
  coverButtons: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  group: { gap: spacing.sm },
  fieldLabel: { fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  statusRow: { flexDirection: "row", gap: spacing.sm },
  footer: { gap: spacing.sm, paddingTop: spacing.sm },
});
