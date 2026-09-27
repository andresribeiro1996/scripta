import { View } from "react-native";
import { SvgXml } from "react-native-svg";
import { READER_PLATES, renderGlyph, type IdentityKey } from "@scripta/shared";
import { useTheme } from "../../ui";

export function ReaderGlyph({ identity }: { identity?: IdentityKey }) {
  const { mode } = useTheme();
  if (!identity) return null;
  const name = READER_PLATES.find((plate) => plate.key === identity)!.name;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={`the ${name}`} style={{ width: 24, height: 24 }}>
      <SvgXml xml={renderGlyph(identity, 24, mode === "dark" ? "reversed" : "paper")} width={24} height={24} />
    </View>
  );
}
