import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { AccessibilityInfo, useColorScheme } from "react-native";

export const palettes = {
  light: {
    background: "#f5f4f2",
    surface: "#ffffff",
    surfacePressed: "#fbfaf8",
    text: "#201e1c",
    textDim: "#6b6560",
    border: "#e4e0da",
    accent: "#a85c32",
    accentSoft: "#f1e2d8",
    danger: "#b3432f",
    dangerSoft: "#f6dfda",
    success: "#47713c",
    successSoft: "#e4efdf",
    scrim: "rgba(32, 30, 28, 0.48)",
    onAccent: "#ffffff",
    onDanger: "#ffffff",
  },
  dark: {
    background: "#1a1815",
    surface: "#242220",
    surfacePressed: "#2b2926",
    text: "#ece8e3",
    textDim: "#a39c93",
    border: "#38342f",
    accent: "#e08a52",
    accentSoft: "#3a2c22",
    danger: "#e08072",
    dangerSoft: "#3a2420",
    success: "#8fbf7f",
    successSoft: "#262f21",
    scrim: "rgba(0, 0, 0, 0.64)",
    onAccent: "#1a1815",
    onDanger: "#1a1815",
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
