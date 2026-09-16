import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";
import { dynamicType, radii, useTheme } from "../../ui";

export function BookCover({ cover, title, width, height }: { cover: string | null; title: string; width: number; height: number }) {
  const { colors } = useTheme();
  const box = { width, height, borderRadius: radii.sm };
  if (cover) return <Image source={cover} style={box} contentFit="cover" />;
  return (
    <View style={[box, styles.fallback, { backgroundColor: colors.accentSoft }]}>
      <Text {...dynamicType} style={{ color: colors.accent }}>{title.charAt(0)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: "center", justifyContent: "center" },
});
