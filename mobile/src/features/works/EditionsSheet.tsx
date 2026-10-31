import { FlatList, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { editionLabel, type WorkEdition } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { Icon, Sheet, dynamicType, minimumTouchTarget, spacing, typography, useTheme } from "../../ui";
import { BookCover } from "../arena/BookCover";
import { useLocale } from "../../i18n";

const LIST_HEIGHT_FRACTION = 0.6;

export function EditionsSheet({ editions, selectedIndex, mineIndex, visible, onClose, onSelect }: {
  editions: WorkEdition[];
  selectedIndex: number;
  mineIndex: number | null;
  visible: boolean;
  onClose: () => void;
  onSelect: (bookId: string) => void;
}) {
  const locale = useLocale();
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
  return (
    <Sheet visible={visible} title="Editions" onClose={onClose}>
      <FlatList
        data={editions}
        keyExtractor={(edition) => edition.bookId}
        style={[styles.list, { maxHeight: height * LIST_HEIGHT_FRACTION }]}
        renderItem={({ item, index }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: index === selectedIndex }}
            onPress={() => {
              onSelect(item.bookId);
              onClose();
            }}
            style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surfacePressed : "transparent" }]}
          >
            <BookCover cover={item.coverUrl} title={item.title} width={36} height={54} />
            <View style={styles.text}>
              <Text {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{item.title}</Text>
              <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{editionLabel(item, locale)}</Text>
              {index === mineIndex ? <Text {...dynamicType} style={[typography.body, { color: colors.accent }]}>Yours</Text> : null}
            </View>
            {index === selectedIndex ? <Icon name="confirm" size={18} color={colors.accent} /> : null}
          </Pressable>
        )}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { flexGrow: 0, marginHorizontal: -spacing.xl },
  row: { minHeight: minimumTouchTarget, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm },
  text: { flex: 1 },
  strong: { fontWeight: "700" }
});
