import { View } from "react-native";
import { SvgXml } from "react-native-svg";
import { readerGlyphLabel, renderGlyph, type IdentityKey } from "@scripta/shared";
import { useTheme } from "../../ui";
import { useLocale } from "../../i18n";

export function ReaderGlyph({ identity, size = 24 }: { identity?: IdentityKey; size?: number }) {
  const locale = useLocale();
  const { mode } = useTheme();
  if (!identity || !readerGlyphLabel(identity, locale)) return null;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size }}
    >
      <SvgXml xml={renderGlyph(identity, size, mode === "dark" ? "reversed" : "paper")} width={size} height={size} />
    </View>
  );
}
