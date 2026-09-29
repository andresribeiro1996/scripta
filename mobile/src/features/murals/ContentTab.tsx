import { ALL_STAT_METRICS, BOOK_GENRES, resolveHomeBlock, type BlockType, type Group, type MuralBlock } from "@scripta/shared";
import { Pressable, StyleSheet, View } from "react-native";
import { Button, Input } from "../../ui";
import { Text } from "../../ui/Text";
import { spacing, typography, useTheme } from "../../ui/theme";
import type { GalleryImage } from "../gallery/api";
import type { Tierlist } from "../tierlists/api";

export type PickerKind = "book" | "image" | "tierlist";

const CONTENTLESS: ReadonlySet<BlockType> = new Set<BlockType>(["currentlyReading", "empty", "readerCard"]);

export function hasContentFields(type: BlockType): boolean {
  return !CONTENTLESS.has(type);
}

export function ContentTab({ block, books, groups, update, onPick }: {
  block: MuralBlock;
  books: Array<Record<string, unknown>>;
  groups: Group[];
  images: GalleryImage[];
  tierlists: Tierlist[];
  update: (transform: (block: MuralBlock) => MuralBlock) => void;
  onPick: (kind: PickerKind) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.tab}>
      {block.type === "shelf" ? <>
        <Text style={{ color: colors.text }}>Shelf source</Text>
        <Button label="Pick books (keep the current selection)" variant="secondary" onPress={() => update((block) => block.type === "shelf" ? { ...block, collectionId: undefined, bookKeys: (resolveHomeBlock(block, books, groups, "") as typeof block).bookKeys } : block)} />
        {groups.filter((group) => group.type === "collection").map((group) => <Button key={group.id} label={`Follow ${group.name}`} variant="secondary" onPress={() => update((block) => block.type === "shelf" ? { ...block, collectionId: group.id, bookKeys: [] } : block)} />)
        }
        {block.collectionId ? <Text style={{ color: colors.textDim }}>Following a collection. Leave the title blank to use its name.</Text> : null}
      </> : null}
      {block.type === "quote" ? <><Button label="Rediscover a passage" variant="secondary" onPress={() => update((block) => block.type === "quote" ? { ...block, mode: "rediscover", bookKey: "", highlightId: "" } : block)} /><Text style={{ color: colors.textDim }}>Only known book passages are rediscovered. Choose books below to pin a specific highlight instead.</Text></> : null}
      {block.type === "text" ? <><Input label="Heading" value={block.heading} onChangeText={(heading) => update((block) => ({ ...block, heading } as MuralBlock))} /><Input label="Body" value={block.body} multiline onChangeText={(body) => update((block) => ({ ...block, body } as MuralBlock))} /></> : null}
      {block.type === "profile" ? <><Input label="Biography" value={block.bio} multiline onChangeText={(bio) => update((block) => block.type === "profile" ? { ...block, bio } : block)} /><Text style={{ color: colors.text }}>What I like</Text><View style={styles.genreChoices}>{BOOK_GENRES.map((genre) => { const checked = block.favoriteGenres.includes(genre); return <Pressable key={genre} accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => update((block) => block.type === "profile" ? { ...block, favoriteGenres: checked ? block.favoriteGenres.filter((item) => item !== genre) : [...block.favoriteGenres, genre] } : block)} style={[styles.genreChoice, { backgroundColor: checked ? colors.accentSoft : colors.surface, borderColor: checked ? colors.accent : colors.border }]}><Text style={{ color: checked ? colors.accent : colors.text }}>{genre}</Text></Pressable>; })}</View></> : null}
      {block.type === "shelf" || block.type === "quoteCollection" ? <Input label="Title" value={block.title} onChangeText={(title) => update((block) => ({ ...block, title } as MuralBlock))} /> : null}
      {block.type === "spotlight" || block.type === "image" ? <Input label="Caption" value={block.caption ?? ""} onChangeText={(caption) => update((block) => ({ ...block, caption } as MuralBlock))} /> : null}
      {block.type === "stats" ? <View style={styles.tab}>{ALL_STAT_METRICS.map((metric) => <Pressable accessibilityLabel={metric} accessibilityRole="checkbox" accessibilityState={{ checked: block.metrics.includes(metric) }} key={metric} onPress={() => update((block) => block.type === "stats" ? { ...block, metrics: block.metrics.includes(metric) ? block.metrics.filter((item) => item !== metric) : [...block.metrics, metric] } : block)}><Text style={[typography.body, { color: block.metrics.includes(metric) ? colors.accent : colors.text }]}>✓ {metric}</Text></Pressable>)}</View> : null}
      {block.type === "spotlight" || (block.type === "shelf" && !block.collectionId) || block.type === "quote" || block.type === "quoteCollection" ? <Button label="Choose books" onPress={() => onPick("book")} /> : null}
      {block.type === "image" ? <Button label="Choose image" onPress={() => onPick("image")} /> : null}
      {block.type === "tierlist" ? <Button label="Choose tier list" onPress={() => onPick("tierlist")} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tab: { gap: spacing.sm },
  genreChoices: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  genreChoice: { borderWidth: 1, borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
