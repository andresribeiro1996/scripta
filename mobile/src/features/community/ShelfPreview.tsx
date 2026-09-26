import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { Group, Mural, ReaderProfile } from "@scripta/shared";
import { Button, dynamicType, spacing, typography, useTheme } from "../../ui";
import type { GalleryImage } from "../gallery/api";
import { MuralCanvas } from "../murals";
import type { Tierlist } from "../tierlists/api";

export function ShelfPreview({ mural, summary, busy, books, groups, images, tierlists, profile, onKeep, onBlank }: {
  mural: Mural;
  summary: string;
  busy: boolean;
  books: Array<Record<string, unknown>>;
  groups: Group[];
  images: GalleryImage[];
  tierlists: Tierlist[];
  profile?: ReaderProfile;
  onKeep: () => void;
  onBlank: () => void;
}) {
  const { colors } = useTheme();
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{summary}</Text>
      <View style={styles.actions}>
        <Button label="Keep this shelf" loading={busy} disabled={busy} onPress={onKeep} />
        <Button label="Start blank" variant="secondary" disabled={busy} onPress={onBlank} />
      </View>
      <MuralCanvas mural={mural} books={books} groups={groups} images={images} tierlists={tierlists} profile={profile} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.lg, gap: spacing.md },
  actions: { gap: spacing.sm }
});
