// One place where the native stack chrome is dressed in the app's tokens, so
// the four tab stacks can't drift from each other. Every screen used to draw
// its own header View instead, which is why none of them had a back gesture.
import type { NativeStackNavigationOptions } from "expo-router";
import { useTheme } from "./theme";

export function useScreenOptions(): NativeStackNavigationOptions {
  const { colors } = useTheme();
  return {
    headerStyle: { backgroundColor: colors.background },
    headerTintColor: colors.accent,
    headerTitleStyle: { color: colors.text, fontWeight: "700" },
    headerShadowVisible: false,
    // iOS only, and ignored elsewhere: the title starts large and collapses
    // into the bar as the screen scrolls.
    headerLargeTitleEnabled: true,
    headerLargeTitleStyle: { color: colors.text },
    headerLargeTitleShadowVisible: false,
    headerLargeStyle: { backgroundColor: colors.background },
    // "Back" spelled out crowds a phone header; the chevron alone is the
    // platform default on anything but a short title.
    headerBackButtonDisplayMode: "minimal",
    contentStyle: { backgroundColor: colors.background },
  };
}

/** Detent-backed sheet presentation for the screens that used to be modals. */
export function sheetOptions(title: string): NativeStackNavigationOptions {
  return {
    title,
    presentation: "formSheet",
    sheetGrabberVisible: true,
    sheetAllowedDetents: [0.6, 1],
    headerLargeTitleEnabled: false,
  };
}
