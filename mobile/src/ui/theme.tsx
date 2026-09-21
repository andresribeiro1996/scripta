import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { AccessibilityInfo, useColorScheme } from "react-native";

export const palettes = {
  light: {
    background: "#f2f0ec",
    surface: "#ffffff",
    surfacePressed: "#f7f5f1",
    text: "#201e1c",
    textDim: "#6b6560",
    border: "#ddd8d0",
    accent: "#a85c32",
    accentSoft: "#f1e2d8",
    // A fill that has to outrank a border. accentSoft is a wash for things
    // that sit behind accent-coloured text (avatars, cover fallbacks,
    // badges), so it is deliberately weak — at 1.11:1 in light and 1.39:1
    // in dark it separates from the page LESS than a hairline does (1.25
    // and 1.82), which puts structure above meaning wherever it marks a
    // selection. This one carries more of the accent: 24% in light, 34% in
    // dark, both landing just above their borders with body text still over
    // 8:1 on top.
    accentFill: "#e0ccbf",
    danger: "#b3432f",
    dangerSoft: "#f6dfda",
    success: "#47713c",
    successSoft: "#e4efdf",
    scrim: "rgba(32, 30, 28, 0.48)",
    onAccent: "#ffffff",
    onDanger: "#ffffff",
  },
  dark: {
    background: "#141210",
    surface: "#2a2724",
    surfacePressed: "#333029",
    text: "#ece8e3",
    textDim: "#a8a199",
    border: "#45403a",
    accent: "#e08a52",
    accentSoft: "#3a2c22",
    accentFill: "#593b26",
    danger: "#e08072",
    dangerSoft: "#3a2420",
    success: "#8fbf7f",
    successSoft: "#262f21",
    scrim: "rgba(0, 0, 0, 0.64)",
    onAccent: "#141210",
    onDanger: "#141210",
  },
} as const;

export const spacing = { none: 0, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48 } as const;
export const radii = { sm: 6, md: 8, lg: 12, xl: 16, full: 999 } as const;
export const typography = {
  caption: { fontSize: 12, lineHeight: 16 },
  body: { fontSize: 14, lineHeight: 20 },
  input: { fontSize: 16, lineHeight: 22 },
  title: { fontSize: 18, lineHeight: 24 },
  heading: { fontSize: 24, lineHeight: 30 },
} as const;
export const minimumTouchTarget = 44;
export const dynamicType = { allowFontScaling: true } as const;

export type ThemeMode = keyof typeof palettes;
export type ThemeColors = (typeof palettes)[ThemeMode];
export type Theme = { mode: ThemeMode; colors: ThemeColors };

const ThemeContext = createContext<Theme | undefined>(undefined);

function systemTheme(scheme: ReturnType<typeof useColorScheme>): Theme {
  const mode: ThemeMode = scheme === "dark" ? "dark" : "light";
  return { mode, colors: palettes[mode] };
}

export function ThemeProvider({ children, mode }: { children: ReactNode; mode?: ThemeMode }) {
  const scheme = useColorScheme();
  const resolvedMode = mode ?? (scheme === "dark" ? "dark" : "light");
  return <ThemeContext.Provider value={{ mode: resolvedMode, colors: palettes[resolvedMode] }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const context = useContext(ThemeContext);
  const scheme = useColorScheme();
  return context ?? systemTheme(scheme);
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduced);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => subscription.remove();
  }, []);

  return reduced;
}
