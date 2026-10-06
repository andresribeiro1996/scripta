import { useCallback, type ReactNode } from "react";
import { Stack, useFocusEffect, useNavigation } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { StatusBar } from "expo-status-bar";
import type { ThemeId } from "@scripta/shared/themes";
import { Screen } from "../../ui";
import { fontStyleFor } from "../../ui/fontStyle";
import { useScreenOptions } from "../../ui/navigation";
import { MuralThemeScope, useTheme, type Theme } from "../../ui/theme";

export function MuralScreen({ theme, bottom, children }: { theme: ThemeId; bottom?: boolean; children: ReactNode }) {
  const appTheme = useTheme();
  return <MuralThemeScope theme={theme}><ThemedScreen appTheme={appTheme} bottom={bottom}>{children}</ThemedScreen></MuralThemeScope>;
}

function ThemedScreen({ appTheme, bottom, children }: { appTheme: Theme; bottom?: boolean; children: ReactNode }) {
  const theme = useTheme();
  const options = useScreenOptions();
  const navigation = useNavigation();
  const focused = useIsFocused();

  useFocusEffect(useCallback(() => {
    const tabs = navigation.getParent();
    if (tabs?.getState().type !== "tab") return;
    const apply = ({ colors, fonts }: Theme) => tabs.setOptions({
      tabBarActiveTintColor: colors.accent,
      tabBarInactiveTintColor: colors.textDim,
      tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      tabBarLabelStyle: fontStyleFor(fonts.text, "text", { fontSize: 10 }) ?? undefined,
    });
    apply(theme);
    return () => apply(appTheme);
  }, [navigation, theme, appTheme]));

  return <Screen top={false} bottom={bottom}>
    <Stack.Screen options={options} />
    {focused ? <StatusBar style={theme.mode === "dark" ? "light" : "dark"} /> : null}
    {children}
  </Screen>;
}
