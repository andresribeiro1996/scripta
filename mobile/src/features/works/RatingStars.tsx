import { StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { Text } from "../../ui/Text";
import { dynamicType, spacing, typography, useTheme } from "../../ui";

const STARS = [0, 1, 2, 3, 4];
const STAR_SIZE = 12;

function Star({ fraction }: { fraction: number }) {
  const { colors } = useTheme();
  const glyph = (color: string) => (
    <Svg width={STAR_SIZE} height={STAR_SIZE} viewBox="3.2 3 17.6 17.6">
      <Path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" fill={color} />
    </Svg>
  );
  return (
    <View style={styles.star}>
      <View style={styles.dim}>{glyph(colors.textDim)}</View>
      <View style={[styles.fill, { width: fraction * STAR_SIZE }]}>{glyph(colors.accent)}</View>
    </View>
  );
}

export function RatingStars({ value, label }: { value: number; label: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <View accessible accessibilityRole="image" accessibilityLabel={`Rated ${value.toFixed(1)} out of 5`} style={styles.stars}>
        {STARS.map((star) => (
          <Star key={star} fraction={Math.min(1, Math.max(0, value - star))} />
        ))}
      </View>
      <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stars: { flexDirection: "row", gap: 2 },
  star: { width: STAR_SIZE, height: STAR_SIZE },
  dim: { opacity: 0.4 },
  fill: { position: "absolute", top: 0, left: 0, overflow: "hidden" },
});
