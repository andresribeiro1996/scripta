import type {
  BlockFontFamily,
  CardBorderStyle,
  CardFontFamily,
} from "@scripta/shared";
import { Platform, type ViewStyle } from "react-native";

export type { BlockFontFamily, BlockStyle, CardBorderStyle, CardFontFamily, LibraryStyleSettings, PerCardStyle } from "@scripta/shared";

const sans = Platform.select({ ios: "System", android: "sans-serif", default: "sans-serif" });
const serif = Platform.select({ ios: "Georgia", android: "serif", default: "serif" });
const mono = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

const fontFamilies: Record<CardFontFamily | BlockFontFamily, string> = {
  sans,
  serif,
  mono,
  playfairDisplay: serif,
  inter: sans,
  jetbrainsMono: mono,
};

export function cardFontFamily(value: CardFontFamily): string {
  return fontFamilies[value] ?? sans;
}

export function blockFontFamily(value: BlockFontFamily): string {
  return fontFamilies[value] ?? sans;
}

export function resolveBorderColor(color: string | null, opacityPercent: number, themeBorderColor: string): string {
  const opacity = Math.max(0, Math.min(100, opacityPercent));
  const resolved = color ?? themeBorderColor;
  if (opacity === 100) return resolved;
  const hex = resolved.replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((value) => value + value).join("") : hex;
  const parsed = Number.parseInt(full, 16);
  if (Number.isNaN(parsed) || full.length !== 6) return resolved;
  return `rgba(${(parsed >> 16) & 255}, ${(parsed >> 8) & 255}, ${parsed & 255}, ${opacity / 100})`;
}

const borderStyles: Record<CardBorderStyle, NonNullable<ViewStyle["borderStyle"]>> = {
  solid: "solid",
  dotted: "dotted",
  dashed: "dashed",
  double: "solid",
  groove: "dotted",
  ridge: "dashed",
};

export function resolveBorderStyle(value: CardBorderStyle): NonNullable<ViewStyle["borderStyle"]> {
  return borderStyles[value] ?? "solid";
}
