import { ALL_STAT_METRICS, BOOK_GENRES, STAT_METRIC_LABELS, bookKey, resolveHomeBlock, resolveQuote, type Group, type MuralBlock } from "@scripta/shared";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon, Input, Segmented } from "../../ui";
import { Text } from "../../ui/Text";
import { minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui/theme";
import type { GalleryImage } from "../gallery/api";
import { SelectRow, ToggleRow } from "../library/components/StyleControls";
import type { Tierlist } from "../tierlists/api";

export type PickerKind = "book" | "image" | "tierlist";

const SHELF_SOURCES = [{ value: "pick", label: "Pick books" }, { value: "follow", label: "Follow a collection" }] as const;
const QUOTE_SOURCES = [{ value: "pinned", label: "Pinned passage" }, { value: "rediscover", label: "Rediscover" }] as const;

function PickerRow({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={onPress}
      style={({ pressed }) => [styles.pickerRow, { borderColor: colors.border, backgroundColor: pressed ? colors.surfacePressed : colors.surface }]}
    >
      <Text style={[typography.body, { color: colors.text, fontWeight: "600" }]}>{label}</Text>
      <View style={styles.pickerValue}>
        <Text numberOfLines={1} style={[typography.body, styles.pickerValueText, { color: colors.textDim }]}>{value}</Text>
        <Icon name="chevronRight" color={colors.textDim} size={18} />
      </View>
    </Pressable>
  );
}

export function ContentTab({ block, books, groups, images, tierlists, update, onPick }: {
  block: MuralBlock;
  books: Array<Record<string, unknown>>;
  groups: Group[];
  images: GalleryImage[];
  tierlists: Tierlist[];
  update: (transform: (block: MuralBlock) => MuralBlock) => void;
  onPick: (kind: PickerKind) => void;
}) {
  const { colors } = useTheme();
  const collections = groups.filter((group) => group.type === "collection");
  const bookTitle = (key: string) => key ? String(books.find((book) => bookKey(book) === key)?.Title ?? "Book unavailable") : "None";
  const hint = (text: string) => <Text style={[typography.caption, { color: colors.textDim }]}>{text}</Text>;

  if (block.type === "shelf") {
    const following = collections.some((group) => group.id === block.collectionId);
    return (
      <View style={styles.tab}>
        <Input label="Title" value={block.title} hint={following ? "Leave blank to use the collection's name." : undefined} onChangeText={(title) => update((item) => item.type === "shelf" ? { ...item, title } : item)} />
        {collections.length ? <Segmented options={SHELF_SOURCES} value={following ? "follow" : "pick"} accessibilityLabel="Shelf source" onChange={(source) => update((item) => item.type !== "shelf" ? item : source === "follow" ? { ...item, collectionId: collections[0]!.id, bookKeys: [] } : { ...item, collectionId: undefined, bookKeys: (resolveHomeBlock(item, books, groups, "") as typeof item).bookKeys })} /> : null}
        {following
          ? <SelectRow label="Collection" value={block.collectionId!} options={collections.map((group) => ({ value: group.id, label: group.name }))} onChange={(collectionId) => update((item) => item.type === "shelf" ? { ...item, collectionId, bookKeys: [] } : item)} />
          : <PickerRow label="Books" value={`${block.bookKeys.length} chosen`} onPress={() => onPick("book")} />}
      </View>
    );
  }

  if (block.type === "spotlight") {
    return (
      <View style={styles.tab}>
        <PickerRow label="Book" value={bookTitle(block.bookKey)} onPress={() => onPick("book")} />
        <Input label="Caption" value={block.caption ?? ""} onChangeText={(caption) => update((block) => ({ ...block, caption } as MuralBlock))} />
      </View>
    );
  }

  if (block.type === "quote") {
    const quote = resolveQuote(block, books);
    return (
      <View style={styles.tab}>
        <Segmented options={QUOTE_SOURCES} value={block.mode === "rediscover" ? "rediscover" : "pinned"} accessibilityLabel="Passage source" onChange={(source) => update((item) => item.type !== "quote" ? item : source === "rediscover" ? { ...item, mode: "rediscover", bookKey: "", highlightId: "" } : { ...item, mode: undefined })} />
        {block.mode === "rediscover"
          ? hint("A different passage from your books each day. Only passages from known books are used.")
          : <PickerRow label="Passage" value={quote ? String(quote.highlight.Text || quote.highlight.Annotation || "Untitled passage") : "None"} onPress={() => onPick("book")} />}
      </View>
    );
  }

  if (block.type === "quoteCollection") {
    return (
      <View style={styles.tab}>
        <Input label="Title" value={block.title} onChangeText={(title) => update((block) => ({ ...block, title } as MuralBlock))} />
        <PickerRow label="Passages" value={String(block.quotes.length)} onPress={() => onPick("book")} />
      </View>
    );
  }

  if (block.type === "image") {
    return (
      <View style={styles.tab}>
        <PickerRow label="Image" value={images.find((image) => image.id === block.imageId)?.filename ?? "None"} onPress={() => onPick("image")} />
        <Input label="Caption" value={block.caption ?? ""} onChangeText={(caption) => update((block) => ({ ...block, caption } as MuralBlock))} />
      </View>
    );
  }

  if (block.type === "text") {
    return (
      <View style={styles.tab}>
        <Input label="Heading" value={block.heading} onChangeText={(heading) => update((block) => ({ ...block, heading } as MuralBlock))} />
        <Input label="Body" value={block.body} multiline onChangeText={(body) => update((block) => ({ ...block, body } as MuralBlock))} />
      </View>
    );
  }

  if (block.type === "profile") {
    return (
      <View style={styles.tab}>
        <Input label="Biography" value={block.bio} multiline onChangeText={(bio) => update((block) => block.type === "profile" ? { ...block, bio } : block)} />
        <Text style={{ color: colors.text }}>What I like</Text>
        <View style={styles.genreChoices}>
          {BOOK_GENRES.map((genre) => {
            const checked = block.favoriteGenres.includes(genre);
            return (
              <Pressable key={genre} accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => update((block) => block.type === "profile" ? { ...block, favoriteGenres: checked ? block.favoriteGenres.filter((item) => item !== genre) : [...block.favoriteGenres, genre] } : block)} style={[styles.genreChoice, { backgroundColor: checked ? colors.accentSoft : colors.surface, borderColor: checked ? colors.accent : colors.border }]}>
                <Text style={{ color: checked ? colors.accent : colors.text }}>{genre}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  if (block.type === "stats") {
    return (
      <View style={styles.tab}>
        {ALL_STAT_METRICS.map((metric) => <ToggleRow key={metric} label={STAT_METRIC_LABELS[metric]} checked={block.metrics.includes(metric)} onChange={(checked) => update((item) => item.type === "stats" ? { ...item, metrics: checked ? [...item.metrics, metric] : item.metrics.filter((value) => value !== metric) } : item)} />)}
      </View>
    );
  }

  if (block.type === "tierlist") {
    return (
      <View style={styles.tab}>
        <PickerRow label="Tier list" value={tierlists.find((item) => item.id === block.tierlistId)?.name ?? "None"} onPress={() => onPick("tierlist")} />
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  tab: { gap: spacing.sm },
  genreChoices: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  genreChoice: { borderWidth: 1, borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  pickerRow: { minHeight: minimumTouchTarget, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  pickerValue: { flexShrink: 1, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  pickerValueText: { flexShrink: 1 },
});
