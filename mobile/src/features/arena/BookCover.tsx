import { useState } from "react";
import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";
import { dynamicType, radii, typography, useTheme } from "../../ui";

type BookCoverProps =
  | { cover: string | null; title: string; width: number; height: number; fill?: false }
  | { cover: string | null; title: string; fill: true };

export function BookCover(props: BookCoverProps) {
  const { cover, title } = props;
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  const box = props.fill ? StyleSheet.absoluteFill : { width: props.width, height: props.height, borderRadius: radii.sm };
  if (cover && !failed) return <Image source={cover} style={box} contentFit="cover" onError={() => setFailed(true)} />;
  return (
    <View style={[box, styles.fallback, { backgroundColor: colors.accentSoft }]}>
      <Text {...dynamicType} style={[props.fill && typography.heading, { color: colors.accent }]}>{title.charAt(0)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: "center", justifyContent: "center" },
});
