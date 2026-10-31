import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "../../../ui/Text";
import { Icon } from "../../../ui/icon";
import { dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../../ui/theme";

export function ShareLayoutPicker<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { readonly value: T; readonly label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="tablist" style={[styles.row, { borderColor: colors.border }]}>
      {options.map((option, position) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => { if (!selected) onChange(option.value); }}
            style={({ pressed }) => [
              styles.segment,
              position > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
              { backgroundColor: selected ? colors.accentFill : pressed ? colors.surfacePressed : colors.surface },
            ]}
          >
            <View style={{ opacity: selected ? 1 : 0 }}><Icon name="confirm" size={typography.caption.fontSize} color={colors.text} /></View>
            <Text {...dynamicType} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[typography.caption, styles.label, { color: colors.text }]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.full, overflow: "hidden" },
  segment: { flex: 1, minHeight: minimumTouchTarget, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs },
  label: { fontWeight: "600", flexShrink: 1 },
});
