import { useCallback, type ReactNode } from "react";
import { Stack, useFocusEffect } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { StatusBar } from "expo-status-bar";
import type { ThemeId } from "@scripta/shared/themes";
import { Screen } from "../../ui";
import { useScreenOptions } from "../../ui/navigation";
import { useSetTabTheme } from "../../ui/tabTheme";
import { MuralThemeScope, useTheme } from "../../ui/theme";

export function MuralScreen({ theme, bottom, children }: { theme: ThemeId; bottom?: boolean; children: ReactNode }) {
  return <MuralThemeScope theme={theme}><ThemedScreen bottom={bottom}>{children}</ThemedScreen></MuralThemeScope>;
}

function ThemedScreen({ bottom, children }: { bottom?: boolean; children: ReactNode }) {
  const theme = useTheme();
  const options = useScreenOptions();
  const setTabTheme = useSetTabTheme();
  const focused = useIsFocused();

  useFocusEffect(useCallback(() => {
    if (!setTabTheme) return;
    setTabTheme(theme);
    return () => setTabTheme(null);
  }, [setTabTheme, theme]));

  return <Screen top={false} bottom={bottom}>
    <Stack.Screen options={options} />
    {focused ? <StatusBar style={theme.mode === "dark" ? "light" : "dark"} /> : null}
    {children}
  </Screen>;
}
