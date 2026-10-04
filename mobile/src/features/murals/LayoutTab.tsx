import { GRID_COLUMNS, type BlockLayout, type MuralBlock } from "@scripta/shared";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { Icon } from "../../ui";
import { radii, spacing, typography, useTheme } from "../../ui/theme";
import { layoutStepBlocked, type LayoutStepBlock } from "./layout";

const REASONS: Partial<Record<LayoutStepBlock, string>> = { edge: "Reached the edge of the mural", overlap: "Another block is in the way" };

function SizeStepper({ label, value, unit, decrease, increase, disabled, onStep }: {
  label: string;
  value: number;
  unit: string;
  decrease: LayoutStepBlock | null;
  increase: LayoutStepBlock | null;
  disabled: boolean;
  onStep: (delta: number) => void;
}) {
  const { colors } = useTheme();
  const button = (delta: number, blocked: LayoutStepBlock | null, glyph: string, verb: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${verb} ${label.toLowerCase()}`}
      accessibilityState={{ disabled: disabled || blocked !== null }}
      disabled={disabled || blocked !== null}
      onPress={() => onStep(delta)}
      style={({ pressed }) => [styles.step, { opacity: disabled || blocked ? 0.4 : 1, backgroundColor: pressed ? colors.surfacePressed : colors.surface }]}
    >
      <Text style={[typography.title, { color: blocked ? colors.textDim : colors.accent }]}>{glyph}</Text>
    </Pressable>
  );
  const reason = increase ? REASONS[increase] : undefined;
  return (
    <View style={styles.row}>
      <View style={styles.heading}>
        <Text style={[typography.body, { color: colors.text, fontWeight: "600" }]}>{label}</Text>
        <Text style={[typography.caption, { color: colors.textDim }]}>{unit}</Text>
      </View>
      <View style={[styles.stepper, { borderColor: colors.border, backgroundColor: colors.background }]}>
        {button(-1, decrease, "−", "Decrease")}
        <Text style={[typography.body, styles.value, { color: colors.text, fontWeight: "600" }]}>{value}</Text>
        {button(1, increase, "+", "Increase")}
      </View>
      {reason ? <Text style={[typography.caption, { color: colors.textDim }]}>{reason}</Text> : null}
    </View>
  );
}

export function LayoutTab({ block, blocks, disabled = false, onToggleExpansion, onChange }: { block: MuralBlock; blocks: MuralBlock[]; disabled?: boolean; onToggleExpansion: (axis: "w" | "h") => void; onChange: (patch: Partial<BlockLayout>) => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.tab}>
      {(["w", "h"] as const).map((axis) => {
        const label = axis === "w" ? "Width" : "Height";
        const expanded = Boolean(block.expandedFrom?.[axis]);
        const action = `${expanded ? "Restore" : "Expand"} ${label.toLowerCase()}`;
        const value = block.layout[axis];
        return <View key={axis} style={styles.row}>
          <SizeStepper label={label} value={value} unit={axis === "w" ? `of ${GRID_COLUMNS} columns` : value === 1 ? "row" : "rows"} disabled={disabled} decrease={layoutStepBlocked(blocks, block.id, { [axis]: value - 1 })} increase={layoutStepBlocked(blocks, block.id, { [axis]: value + 1 })} onStep={(delta) => onChange({ [axis]: value + delta })} />
          <Pressable accessibilityRole="button" accessibilityLabel={action} accessibilityState={{ disabled }} disabled={disabled} onPress={() => onToggleExpansion(axis)} style={({ pressed }) => [styles.expand, { opacity: disabled ? 0.55 : 1, borderColor: colors.border, backgroundColor: pressed ? colors.surfacePressed : expanded ? colors.accentSoft : colors.surface }]}>
            <Icon name={axis === "w" ? "expandHorizontal" : "expandVertical"} color={colors.accent} size={20} />
            <Text style={[typography.body, { color: colors.accent }]}>{action}</Text>
          </Pressable>
        </View>;
      })}
      <Text style={[typography.caption, { color: colors.textDim }]}>Expansion fills available space in both directions. Tap Restore to return to the previous size.</Text>
      <Text style={[typography.caption, { color: colors.textDim }]}>To move this block, close this sheet, then long-press and drag it on the mural.</Text>
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
