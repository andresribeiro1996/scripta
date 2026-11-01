import { ALL_STAT_METRICS, statMetricLabels, bookKey, resolveHomeBlock, resolveQuote, type Group, type MuralBlock } from "@scripta/shared";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon, Input, Segmented } from "../../ui";
import { Text } from "../../ui/Text";
import { minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui/theme";
import type { GalleryImage } from "../gallery/api";
import { GenreChoices } from "../library/components/GenreChoices";
import { SelectRow, ToggleRow } from "../library/components/StyleControls";
import type { Tierlist } from "../tierlists/api";
import { useLocale, useT } from "../../i18n";

export type PickerKind = "book" | "image" | "tierlist";

function PickerRow({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("murals.pickerRow", { label, value })}
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
  const locale = useLocale();
  const t = useT();
  const { colors } = useTheme();
  const shelfSources = [{ value: "pick", label: t("murals.pickBooks") }, { value: "follow", label: t("murals.followCollection") }] as const;
  const quoteSources = [{ value: "pinned", label: t("murals.pinnedPassage") }, { value: "rediscover", label: t("murals.rediscover") }] as const;
  const collections = groups.filter((group) => group.type === "collection");
  const bookTitle = (key: string) => key ? String(books.find((book) => bookKey(book) === key)?.Title ?? t("book.unavailable")) : t("murals.presetNone");
  const hint = (text: string) => <Text style={[typography.caption, { color: colors.textDim }]}>{text}</Text>;

  if (block.type === "shelf") {
    const following = collections.some((group) => group.id === block.collectionId);
    return (
      <View style={styles.tab}>
        <Input label={t("murals.title")} value={block.title} hint={following ? t("murals.titleBlankHint") : undefined} onChangeText={(title) => update((item) => item.type === "shelf" ? { ...item, title } : item)} />
        {collections.length ? <Segmented options={shelfSources} value={following ? "follow" : "pick"} accessibilityLabel={t("murals.shelfSource")} onChange={(source) => update((item) => item.type !== "shelf" ? item : source === "follow" ? { ...item, collectionId: collections[0]!.id, bookKeys: [] } : { ...item, collectionId: undefined, bookKeys: (resolveHomeBlock(item, books, groups, "", locale) as typeof item).bookKeys })} /> : null}
        {following
          ? <SelectRow label={t("shell.collection")} value={block.collectionId!} options={collections.map((group) => ({ value: group.id, label: group.name }))} onChange={(collectionId) => update((item) => item.type === "shelf" ? { ...item, collectionId, bookKeys: [] } : item)} />
          : <PickerRow label={t("book.books")} value={t("murals.chosenCount", { count: block.bookKeys.length })} onPress={() => onPick("book")} />}
      </View>
    );
  }

  if (block.type === "spotlight") {
    return (
      <View style={styles.tab}>
        <PickerRow label={t("shell.book")} value={bookTitle(block.bookKey)} onPress={() => onPick("book")} />
        <Input label={t("murals.caption")} value={block.caption ?? ""} onChangeText={(caption) => update((block) => ({ ...block, caption } as MuralBlock))} />
      </View>
    );
  }

  if (block.type === "quote") {
    const quote = resolveQuote(block, books);
    return (
      <View style={styles.tab}>
        <Segmented options={quoteSources} value={block.mode === "rediscover" ? "rediscover" : "pinned"} accessibilityLabel={t("murals.passageSource")} onChange={(source) => update((item) => item.type !== "quote" ? item : source === "rediscover" ? { ...item, mode: "rediscover", bookKey: "", highlightId: "" } : { ...item, mode: undefined })} />
        {block.mode === "rediscover"
          ? hint(t("murals.rediscoverNote"))
          : <PickerRow label={t("murals.passage")} value={quote ? String(quote.highlight.Text || quote.highlight.Annotation || t("murals.untitledPassage")) : t("library.none")} onPress={() => onPick("book")} />}
      </View>
    );
  }

  if (block.type === "quoteCollection") {
    return (
      <View style={styles.tab}>
        <Input label={t("murals.title")} value={block.title} onChangeText={(title) => update((block) => ({ ...block, title } as MuralBlock))} />
        <PickerRow label={t("murals.passages")} value={String(block.quotes.length)} onPress={() => onPick("book")} />
      </View>
    );
  }

  if (block.type === "image") {
    return (
      <View style={styles.tab}>
        <PickerRow label={t("murals.image")} value={images.find((image) => image.id === block.imageId)?.filename ?? t("library.none")} onPress={() => onPick("image")} />
        <Input label={t("murals.caption")} value={block.caption ?? ""} onChangeText={(caption) => update((block) => ({ ...block, caption } as MuralBlock))} />
      </View>
    );
  }

  if (block.type === "text") {
    return (
      <View style={styles.tab}>
        <Input label={t("murals.heading")} value={block.heading} onChangeText={(heading) => update((block) => ({ ...block, heading } as MuralBlock))} />
        <Input label={t("murals.body")} value={block.body} multiline onChangeText={(body) => update((block) => ({ ...block, body } as MuralBlock))} />
      </View>
    );
  }

  if (block.type === "profile") {
    return (
      <View style={styles.tab}>
        <Input label={t("murals.biography")} value={block.bio} multiline onChangeText={(bio) => update((block) => block.type === "profile" ? { ...block, bio } : block)} />
        <Text style={{ color: colors.text }}>{t("murals.whatILike")}</Text>
        <GenreChoices value={block.favoriteGenres} onChange={(favoriteGenres) => update((block) => block.type === "profile" ? { ...block, favoriteGenres } : block)} />
      </View>
    );
  }

  if (block.type === "stats") {
    return (
      <View style={styles.tab}>
        {ALL_STAT_METRICS.map((metric) => <ToggleRow key={metric} label={statMetricLabels(locale)[metric]} checked={block.metrics.includes(metric)} onChange={(checked) => update((item) => item.type === "stats" ? { ...item, metrics: checked ? [...item.metrics, metric] : item.metrics.filter((value) => value !== metric) } : item)} />)}
      </View>
    );
  }

  if (block.type === "tierlist") {
    return (
      <View style={styles.tab}>
        <PickerRow label={t("book.gameTierlist")} value={tierlists.find((item) => item.id === block.tierlistId)?.name ?? t("library.none")} onPress={() => onPick("tierlist")} />
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  tab: { gap: spacing.sm },
  pickerRow: { minHeight: minimumTouchTarget, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  pickerValue: { flexShrink: 1, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  pickerValueText: { flexShrink: 1 },
});
