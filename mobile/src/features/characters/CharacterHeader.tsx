import { StyleSheet, View } from "react-native";
import type { CharacterSubject } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { dynamicType, spacing, typography, useTheme } from "../../ui";
import { BookCover } from "../arena/BookCover";

export function CharacterHeader({ subject }: { subject: CharacterSubject }) {
  const { colors } = useTheme();
  return <View accessible accessibilityLabel={`Characters from ${subject.scope.label}`} style={styles.row}>
    <BookCover cover={subject.scope.coverUrl} title={subject.scope.label} width={32} height={48} />
    <Text numberOfLines={2} {...dynamicType} style={[typography.caption, styles.caption, { color: colors.textDim }]}>{`Characters · ${subject.scope.label}`}</Text>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  caption: { flex: 1, fontWeight: "700" },
});
