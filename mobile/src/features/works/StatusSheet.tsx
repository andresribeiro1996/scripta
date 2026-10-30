import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { BookScreenModel } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { Icon, Sheet, Toast, dynamicType, minimumTouchTarget, spacing, typography, useDismissThen, useTheme } from "../../ui";
import { useChangeStatus } from "../library/hooks/useChangeStatus";
import { useLibraryActions } from "../library/hooks/useLibraryActions";
import { FeelingChips } from "../library/components/FeelingChips";

export function StatusSheet({ book, model, visible, onClose }: { book: Record<string, unknown>; model: BookScreenModel; visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const { setRating } = useLibraryActions(setError);
  const changeStatus = useChangeStatus();
  const { then, onDismiss } = useDismissThen(visible, onClose);
  useEffect(() => {
    if (visible) setError(null);
  }, [visible]);
  const { status, feeling } = model;
  if (!status) return null;
  const feelingValue = feeling?.options.find((option) => option.selected)?.rating ?? null;
  return (
    <Sheet visible={visible} title="Your reading" onClose={onClose} onDismiss={onDismiss}>
      <View style={styles.rows}>
        {status.options.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: option.selected }}
            onPress={option.selected ? onClose : () => then(() => void changeStatus(book, option.value))}
            style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surfacePressed : "transparent" }]}
          >
            <Text {...dynamicType} style={[typography.body, styles.label, option.selected ? styles.strong : null, { color: option.selected ? colors.accent : colors.text }]}>{option.label}</Text>
            {option.selected ? <Icon name="confirm" size={18} color={colors.accent} /> : null}
          </Pressable>
        ))}
      </View>
      {feeling ? (
        <View style={styles.feeling}>
          <Text {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>How it landed</Text>
          <FeelingChips
            value={feelingValue}
            onChange={(rating) => {
              setError(null);
              void setRating(book, rating);
            }}
          />
          {error ? <Toast visible message={error} tone="error" /> : null}
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  rows: { marginHorizontal: -spacing.xl },
  row: { minHeight: minimumTouchTarget, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, paddingHorizontal: spacing.xl },
  label: { flex: 1 },
  strong: { fontWeight: "700" },
  feeling: { gap: spacing.sm, marginTop: spacing.lg }
});
