import type { ComponentProps } from "react";
import { StyleSheet, Text as NativeText } from "react-native";
import { fontStyleFor, slotFor, textBreakStrategyFor, type FontStyleInput } from "./fontStyle";
import { useTheme } from "./theme";

export function Text({ display, style, textBreakStrategy, ...props }: ComponentProps<typeof NativeText> & { display?: boolean }) {
  const { fonts } = useTheme();
  const flat = (StyleSheet.flatten(style) ?? {}) as FontStyleInput;
  const slot = slotFor(flat.fontSize, display);
  const themed = fontStyleFor(fonts[slot], slot, flat);
  const hasCustomFont = themed !== null || Boolean(flat.fontFamily);
  return (
    <NativeText
      {...props}
      textBreakStrategy={textBreakStrategyFor(hasCustomFont, textBreakStrategy)}
      style={themed ? [style, themed] : style}
    />
  );
}
