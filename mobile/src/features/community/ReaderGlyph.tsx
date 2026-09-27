import { View } from "react-native";
import { SvgXml } from "react-native-svg";
import { readerGlyphLabel, renderGlyph, type IdentityKey } from "@scripta/shared";
import { useTheme } from "../../ui";

export function ReaderGlyph({ identity }: { identity?: IdentityKey }) {
  const { mode } = useTheme();
  if (!identity || !readerGlyphLabel(identity)) return null;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: 24, height: 24 }}
    >
      <SvgXml xml={renderGlyph(identity, 24, mode === "dark" ? "reversed" : "paper")} width={24} height={24} />
    </View>
  );
}
