import { View } from "react-native";
import { Icon } from "../../ui/icon";
import { useTheme } from "../../ui";

export function DailyChapterArt({ motif }: { motif: string }) {
  const { colors } = useTheme();
  const ink = colors.accent;
  const shape = { backgroundColor: ink };
  let art;
  if (motif === "heart") art = <Icon name="like" filled size={76} color={ink} />;
  else if (motif === "column") art = <View style={{ width: 76, height: 94, alignItems: "center", justifyContent: "space-between" }}><View style={[shape, { width: 76, height: 12, borderTopLeftRadius: 40, borderTopRightRadius: 40 }]} /><View style={{ flexDirection: "row", gap: 10 }}>{[0, 1, 2].map((i) => <View key={i} style={[shape, { width: 12, height: 62, opacity: 1 - i * .15 }]} />)}</View><View style={[shape, { width: 76, height: 9 }]} /></View>;
  else if (motif === "clock" || motif === "planet") art = <View style={{ width: 72, height: 72, borderWidth: 3, borderColor: ink, borderRadius: 40, alignItems: "center", justifyContent: "center" }}>{motif === "clock" ? <><View style={[shape, { width: 3, height: 24, position: "absolute", top: 12 }]} /><View style={[shape, { width: 22, height: 3, position: "absolute", left: 34, top: 34 }]} /></> : <View style={{ width: 92, height: 24, borderWidth: 3, borderColor: ink, borderRadius: 50, transform: [{ rotate: "-25deg" }] }} />}</View>;
  else if (motif === "tiles") art = <View style={{ width: 72, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{[0, 1, 2, 3].map((i) => <View key={i} style={{ width: 32, height: 32, borderWidth: 5, borderRadius: i % 2 ? 16 : 0, borderColor: ink }} />)}</View>;
  else if (motif === "leaf") art = <View style={[shape, { width: 52, height: 86, borderTopLeftRadius: 55, borderBottomRightRadius: 55, transform: [{ rotate: "20deg" }] }]} />;
  else if (motif === "door" || motif === "window") art = <View style={[shape, { width: 64, height: 100, borderTopLeftRadius: 40, borderTopRightRadius: 40 }]}>{motif === "door" ? <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: colors.surface, position: "absolute", right: 10, top: 63 }} /> : <><View style={{ position: "absolute", width: 3, height: 90, backgroundColor: colors.surface, left: 30, top: 8 }} /><View style={{ position: "absolute", width: 64, height: 3, backgroundColor: colors.surface, top: 48 }} /></>}</View>;
  else if (motif === "people" || motif === "portrait") art = <Icon name={motif === "people" ? "community" : "profile"} size={80} color={ink} />;
  else if (motif === "envelope") art = <View style={{ width: 84, height: 58, borderWidth: 3, borderColor: ink, borderRadius: 5, alignItems: "center", overflow: "hidden" }}><View style={{ width: 54, height: 54, borderWidth: 3, borderColor: ink, transform: [{ rotate: "45deg" }], top: -32 }} /></View>;
  else if (motif === "film" || motif === "island") art = <Icon name={motif === "film" ? "image" : "public"} size={80} color={ink} />;
  else art = <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-end" }}>{[70, 94, 80].map((height, index) => <View key={index} style={[shape, { width: 22, height, borderRadius: 4, opacity: 1 - index * .18, transform: [{ rotate: index === 0 ? "-7deg" : index === 2 ? "7deg" : "0deg" }] }]} />)}</View>;
  return <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 96, height: 114, alignItems: "center", justifyContent: "center" }}>{art}</View>;
}
