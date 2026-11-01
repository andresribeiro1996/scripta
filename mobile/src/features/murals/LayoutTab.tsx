import { GRID_COLUMNS, type BlockLayout, type MuralBlock } from "@scripta/shared";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { Icon } from "../../ui";
import { radii, spacing, typography, useTheme } from "../../ui/theme";
import { layoutStepBlocked, type LayoutStepBlock } from "./layout";
import { useT } from "../../i18n";

const REASON_KEYS = { edge: "murals.reasonEdge", overlap: "murals.reasonOverlap" } as const;

function SizeStepper({ label, value, unit, decrease, increase, disabled, onStep }: {
  label: string;
  value: number;
  unit: string;
  decrease: LayoutStepBlock | null;
  increase: LayoutStepBlock | null;
  disabled: boolean;
  onStep: (delta: number) => void;
}) {
  const t = useT();
  const { colors } = useTheme();
  const button = (delta: number, blocked: LayoutStepBlock | null, glyph: string, labelKey: "library.decrease" | "library.increase") => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(labelKey, { label: label.toLowerCase() })}
      accessibilityState={{ disabled: disabled || blocked !== null }}
      disabled={disabled || blocked !== null}
      onPress={() => onStep(delta)}
      style={({ pressed }) => [styles.step, { opacity: disabled || blocked ? 0.4 : 1, backgroundColor: pressed ? colors.surfacePressed : colors.surface }]}
    >
      <Text style={[typography.title, { color: blocked ? colors.textDim : colors.accent }]}>{glyph}</Text>
    </Pressable>
  );
  const reason = increase && increase !== "minimum" ? t(REASON_KEYS[increase]) : undefined;
  return (
    <View style={styles.row}>
      <View style={styles.heading}>
        <Text style={[typography.body, { color: colors.text, fontWeight: "600" }]}>{label}</Text>
        <Text style={[typography.caption, { color: colors.textDim }]}>{unit}</Text>
      </View>
      <View style={[styles.stepper, { borderColor: colors.border, backgroundColor: colors.background }]}>
        {button(-1, decrease, "−", "library.decrease")}
        <Text style={[typography.body, styles.value, { color: colors.text, fontWeight: "600" }]}>{value}</Text>
        {button(1, increase, "+", "library.increase")}
      </View>
      {reason ? <Text style={[typography.caption, { color: colors.textDim }]}>{reason}</Text> : null}
    </View>
  );
}

export function LayoutTab({ block, blocks, disabled = false, onToggleExpansion, onChange }: { block: MuralBlock; blocks: MuralBlock[]; disabled?: boolean; onToggleExpansion: (axis: "w" | "h") => void; onChange: (patch: Partial<BlockLayout>) => void }) {
  const t = useT();
  const { colors } = useTheme();
  return (
    <View style={styles.tab}>
      {(["w", "h"] as const).map((axis) => {
        const label = axis === "w" ? t("library.width") : t("murals.height");
        const expanded = Boolean(block.expandedFrom?.[axis]);
        const action = t(expanded ? "murals.restoreSize" : "murals.expandSize", { label: label.toLowerCase() });
        const value = block.layout[axis];
        return <View key={axis} style={styles.row}>
          <SizeStepper label={label} value={value} unit={axis === "w" ? t("murals.ofColumns", { count: GRID_COLUMNS }) : t("murals.rowUnit", { count: value })} disabled={disabled} decrease={layoutStepBlocked(blocks, block.id, { [axis]: value - 1 })} increase={layoutStepBlocked(blocks, block.id, { [axis]: value + 1 })} onStep={(delta) => onChange({ [axis]: value + delta })} />
          <Pressable accessibilityRole="button" accessibilityLabel={action} accessibilityState={{ disabled }} disabled={disabled} onPress={() => onToggleExpansion(axis)} style={({ pressed }) => [styles.expand, { opacity: disabled ? 0.55 : 1, borderColor: colors.border, backgroundColor: pressed ? colors.surfacePressed : expanded ? colors.accentSoft : colors.surface }]}>
            <Icon name={axis === "w" ? "expandHorizontal" : "expandVertical"} color={colors.accent} size={20} />
            <Text style={[typography.body, { color: colors.accent }]}>{action}</Text>
          </Pressable>
        </View>;
      })}
      <Text style={[typography.caption, { color: colors.textDim }]}>{t("murals.expansionNote")}</Text>
      <Text style={[typography.caption, { color: colors.textDim }]}>{t("murals.moveHint")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tab: { gap: spacing.lg },
  row: { gap: spacing.sm },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, flexWrap: "wrap" },
  stepper: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: radii.lg, overflow: "hidden" },
  step: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  expand: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.sm, borderWidth: 1, borderRadius: radii.lg },
  value: { flex: 1, textAlign: "center" },
});
