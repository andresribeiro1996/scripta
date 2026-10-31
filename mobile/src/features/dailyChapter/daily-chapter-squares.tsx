import { View } from "react-native";
import { useTheme } from "../../ui";

export function DailyChapterSquares({ marks, size = 10 }: { marks: boolean[]; size?: number }) {
  const { colors } = useTheme();
  return <View style={{ flexDirection: "row", gap: 2 }}>{marks.map((right, index) => <View key={index} style={{ width: size, height: size, borderRadius: 2, backgroundColor: right ? colors.accent : colors.border }} />)}</View>;
}
