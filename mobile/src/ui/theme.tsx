import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, Appearance, useColorScheme } from "react-native";
import {
  parseFontPreference,
  parseThemePreference,
  resolveFonts,
  resolveTheme,
  themes,
  type FontId,
  type FontPreference,
  type FontSlot,
  type ThemeColors,
  type ThemeId,
  type ThemePreference,
  type ThemeScheme,
} from "@scripta/shared/themes";

export type { ThemeColors };

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

export type ThemeMode = ThemeScheme;
export type Theme = {
  id: ThemeId;
  mode: ThemeMode;
  colors: ThemeColors;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  fonts: { display: FontId; text: FontId };
  displayFont: FontPreference;
  textFont: FontPreference;
  setFontPreference: (slot: FontSlot, preference: FontPreference) => void;
};

const STORAGE_KEY = "theme";
const FONT_KEYS: Record<FontSlot, string> = { display: "fontDisplay", text: "fontText" };
const SYSTEM_FONTS = { display: "system", text: "system" } as const;
const ThemeContext = createContext<Theme | undefined>(undefined);

function osScheme(scheme: ReturnType<typeof useColorScheme>): ThemeScheme {
  return scheme === "dark" ? "dark" : "light";
}

function applyNativeScheme(preference: ThemePreference): void {
  Appearance.setColorScheme(preference === "system" ? "unspecified" : themes[preference].scheme);
}

export function ThemeProvider({ children, bundledFonts }: { children: ReactNode; bundledFonts: boolean }) {
  const scheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference | null>(null);
  const [displayFont, setDisplayFont] = useState<FontPreference>("theme");
  const [textFont, setTextFont] = useState<FontPreference>("theme");

  useEffect(() => {
    AsyncStorage.multiGet([STORAGE_KEY, FONT_KEYS.display, FONT_KEYS.text]).then(
      (entries) => {
        const stored = new Map(entries);
        const parsed = parseThemePreference(stored.get(STORAGE_KEY));
        applyNativeScheme(parsed);
        setDisplayFont(parseFontPreference("display", stored.get(FONT_KEYS.display)));
        setTextFont(parseFontPreference("text", stored.get(FONT_KEYS.text)));
        setPreferenceState(parsed);
      },
      (err: unknown) => {
        console.warn("Couldn't read the saved appearance; following the system.", err);
        setPreferenceState("system");
      },
    );
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    applyNativeScheme(next);
    setPreferenceState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch((err: unknown) => {
      console.warn("Couldn't save the theme on this device.", err);
    });
  }, []);

  const setFontPreference = useCallback((slot: FontSlot, next: FontPreference) => {
    if (slot === "display") setDisplayFont(next);
    else setTextFont(next);
    AsyncStorage.setItem(FONT_KEYS[slot], next).catch((err: unknown) => {
      console.warn("Couldn't save the font on this device.", err);
    });
  }, []);

  const value = useMemo<Theme | null>(() => {
    if (!preference) return null;
    const id = resolveTheme(preference, osScheme(scheme));
    const fonts = bundledFonts ? resolveFonts(id, displayFont, textFont) : SYSTEM_FONTS;
    return { id, mode: themes[id].scheme, colors: themes[id].colors, preference, setPreference, fonts, displayFont, textFont, setFontPreference };
  }, [preference, scheme, setPreference, bundledFonts, displayFont, textFont, setFontPreference]);

  if (!value) return null;
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const context = useContext(ThemeContext);
  const scheme = useColorScheme();
  if (context) return context;
  const id = osScheme(scheme);
  return {
    id,
    mode: id,
    colors: themes[id].colors,
    preference: "system",
    setPreference: () => {
      throw new Error("setPreference needs a ThemeProvider above it.");
    },
    fonts: SYSTEM_FONTS,
    displayFont: "theme",
    textFont: "theme",
    setFontPreference: () => {
      throw new Error("setFontPreference needs a ThemeProvider above it.");
    },
  };
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
