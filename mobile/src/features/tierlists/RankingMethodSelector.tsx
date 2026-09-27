import { AGGREGATION_MODES, type AggregationMode } from "@scripta/shared";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { dynamicType, radii, typography, useTheme } from "../../ui";

export function RankingMethodSelector({ mode, onChange }: { mode: AggregationMode; onChange: (mode: AggregationMode) => void }) {
  const { colors } = useTheme();
  return <View accessibilityRole="radiogroup" accessibilityLabel="Ranking method" style={[styles.methods, { backgroundColor: colors.background }]}>{AGGREGATION_MODES.map((item) => <Pressable key={item.mode} accessibilityRole="radio" accessibilityState={{ checked: mode === item.mode }} onPress={() => onChange(item.mode)} style={[styles.method, mode === item.mode && { backgroundColor: colors.accentSoft }]}><Text numberOfLines={1} {...dynamicType} style={[typography.caption, { fontWeight: "600" }, { color: mode === item.mode ? colors.text : colors.textDim }]}>{item.label === "Most-voted" ? "Most voted" : item.label}</Text></Pressable>)}</View>;
}

const styles = StyleSheet.create({
  methods: { flex: 1, flexDirection: "row", borderRadius: radii.md, padding: 2 },
  method: { flex: 1, minWidth: 0, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: radii.sm },
});
