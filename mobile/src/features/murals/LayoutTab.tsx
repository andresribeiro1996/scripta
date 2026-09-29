import { GRID_COLUMNS, type BlockLayout, type MuralBlock } from "@scripta/shared";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui/theme";
import { layoutStepBlocked, type LayoutStepBlock } from "./layout";

const REASONS: Partial<Record<LayoutStepBlock, string>> = { edge: "Reached the edge of the mural", overlap: "Another block is in the way" };

function SizeStepper({ label, value, unit, decrease, increase, onStep }: {
  label: string;
  value: number;
  unit: string;
  decrease: LayoutStepBlock | null;
  increase: LayoutStepBlock | null;
  onStep: (delta: number) => void;
}) {
  const { colors } = useTheme();
  const button = (delta: number, blocked: LayoutStepBlock | null, glyph: string, verb: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${verb} ${label.toLowerCase()}`}
      accessibilityState={{ disabled: blocked !== null }}
      disabled={blocked !== null}
      onPress={() => onStep(delta)}
      style={[styles.step, { borderColor: colors.border, opacity: blocked ? 0.4 : 1 }]}
    >
      <Text style={{ color: colors.text, fontWeight: "700" }}>{glyph}</Text>
    </Pressable>
  );
  const reason = increase ? REASONS[increase] : undefined;
  return (
    <View style={styles.row}>
      <View style={styles.line}>
        <Text style={[typography.body, { color: colors.text, fontWeight: "600" }]}>{label}</Text>
        <View style={styles.stepper}>
          {button(-1, decrease, "−", "Decrease")}
          <Text style={[typography.body, styles.value, { color: colors.text }]}>{value} {unit}</Text>
          {button(1, increase, "+", "Increase")}
        </View>
      </View>
      {reason ? <Text style={[typography.caption, { color: colors.textDim }]}>{reason}</Text> : null}
    </View>
  );
}

export function LayoutTab({ block, blocks, onChange }: { block: MuralBlock; blocks: MuralBlock[]; onChange: (patch: Partial<BlockLayout>) => void }) {
  const { colors } = useTheme();
  const { w, h } = block.layout;
  return (
    <View style={styles.tab}>
      <SizeStepper label="Width" value={w} unit={`of ${GRID_COLUMNS} columns`} decrease={layoutStepBlocked(blocks, block.id, { w: w - 1 })} increase={layoutStepBlocked(blocks, block.id, { w: w + 1 })} onStep={(delta) => onChange({ w: w + delta })} />
      <SizeStepper label="Height" value={h} unit={h === 1 ? "row" : "rows"} decrease={layoutStepBlocked(blocks, block.id, { h: h - 1 })} increase={layoutStepBlocked(blocks, block.id, { h: h + 1 })} onStep={(delta) => onChange({ h: h + delta })} />
      <Text style={[typography.caption, { color: colors.textDim }]}>To move this block, close this sheet, then long-press and drag it on the mural.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tab: { gap: spacing.lg },
  row: { gap: spacing.xs },
  line: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  stepper: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  step: { minWidth: minimumTouchTarget, minHeight: minimumTouchTarget, borderWidth: 1, borderRadius: radii.md, alignItems: "center", justifyContent: "center" },
  value: { minWidth: 96, textAlign: "center" },
});
