import type { ComponentProps } from "react";
import { StyleSheet, Text as NativeText } from "react-native";
import { fontStyleFor, slotFor, type FontStyleInput } from "./fontStyle";
import { useTheme } from "./theme";

export function Text({ display, style, ...props }: ComponentProps<typeof NativeText> & { display?: boolean }) {
  const { fonts } = useTheme();
  const flat = (StyleSheet.flatten(style) ?? {}) as FontStyleInput;
  const slot = slotFor(flat.fontSize, display);
  const themed = fontStyleFor(fonts[slot], slot, flat);
  return <NativeText {...props} style={themed ? [style, themed] : style} />;
}
