import { StyleSheet, View } from "react-native";
import type { CharacterSubject } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { dynamicType, spacing, typography, useTheme } from "../../ui";
import { BookCover } from "../arena/BookCover";
import { useT } from "../../i18n";

export function CharacterHeader({ subject }: { subject: CharacterSubject }) {
  const t = useT();
  const { colors } = useTheme();
  return <View accessible accessibilityLabel={t("book.charactersFrom", { label: subject.scope.label })} style={styles.row}>
    <BookCover cover={subject.scope.coverUrl} title={subject.scope.label} width={32} height={48} />
    <Text numberOfLines={2} {...dynamicType} style={[typography.caption, styles.caption, { color: colors.textDim }]}>{t("book.charactersHeader", { label: subject.scope.label })}</Text>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  caption: { flex: 1, fontWeight: "700" },
});
