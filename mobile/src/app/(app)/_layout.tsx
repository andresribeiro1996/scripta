import { pathWithQuery } from "../../features/auth/navigation";
import { usePathname, useGlobalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, BackHandler, View } from "react-native";
import { Redirect, Tabs, useNavigationContainerRef } from "expo-router";
import { newCountLabel } from "@scripta/shared";
import { useAuth } from "../../core/auth";
import { useT } from "../../i18n";
import { useActivityFeed } from "../../features/home/FeedRow";
import { useAccountAppearanceSync } from "../../features/settings/appearanceSync";
import { useGenreEnrichment } from "../../features/library/hooks/useGenreEnrichment";
import { useLibrary } from "../../features/library/hooks/useLibrary";
import { ErrorState } from "../../ui/components";
import { fontStyleFor } from "../../ui/fontStyle";
import { Icon } from "../../ui/icon";
import { backGoesHome, HOME_TAB } from "../../ui/tabBack";
import { TabThemeContext } from "../../ui/tabTheme";
import { useTheme, type Theme } from "../../ui/theme";

function GenreEnrichment() {
  const { data: library, updateLibrary } = useLibrary();
  useGenreEnrichment(library?.data.books ?? [], library?.genres, updateLibrary);
  return null;
}

function AppearanceSync() {
  useAccountAppearanceSync();
  return null;
}

type NavState = { key?: string; type?: string; index?: number; routes: Array<{ name: string; state?: NavState }> };

function findTabs(state: NavState): NavState | null {
  if (state.type === "tab") return state;
  for (const route of state.routes) {
    const found = route.state ? findTabs(route.state) : null;
    if (found) return found;
  }
  return null;
}

function HomeOnBack() {
  const root = useNavigationContainerRef();
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      const tabs = root.isReady() ? findTabs(root.getRootState() as NavState) : null;
      const focused = tabs?.routes[tabs.index ?? 0];
      if (!tabs || !focused || !backGoesHome(focused.name, focused.state?.index ?? 0)) return false;
      const home = tabs.routes.find((route) => route.name === HOME_TAB);
      root.dispatch({ type: "JUMP_TO", payload: { name: HOME_TAB }, target: tabs.key });
      if (home?.state?.key && (home.state.index ?? 0) > 0) root.dispatch({ type: "POP_TO_TOP", target: home.state.key });
      return true;
    });
    return () => subscription.remove();
  }, [root]);
  return null;
}

function AppTabs() {
  const t = useT();
  const appTheme = useTheme();
  const { colors } = appTheme;
  const [tabTheme, setTabTheme] = useState<Theme | null>(null);
  const bar = tabTheme ?? appTheme;
  const { data } = useActivityFeed();
  const newCount = data?.pages[0]?.personalNewCount ?? 0;

  // Each tab is a group holding its own Stack, so a drill-down inside a tab is
  // a real push — with the platform's back chevron and swipe-back — rather than
  // another tab screen hidden with href: null. The group segments don't appear
  // in the URL, so every path is unchanged.
  return (
    <TabThemeContext.Provider value={setTabTheme}>
      <GenreEnrichment />
      <AppearanceSync />
      <HomeOnBack />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: bar.colors.accent,
          tabBarInactiveTintColor: bar.colors.textDim,
          tabBarStyle: { backgroundColor: bar.colors.surface, borderTopColor: bar.colors.border },
          tabBarLabelStyle: fontStyleFor(bar.fonts.text, "text", { fontSize: 10 }) ?? undefined,
        }}
      >
        <Tabs.Screen
          name="(home)"
          options={{
            title: t("shell.tabHome"),
            tabBarBadge: newCountLabel(newCount) ?? undefined,
            tabBarBadgeStyle: { backgroundColor: colors.accent, color: colors.onAccent },
            tabBarIcon: ({ color, focused, size }) => <Icon name="home" filled={focused} color={color} size={size} />,
          }}
        />
        <Tabs.Screen name="(library)" options={{ title: t("shell.tabLibrary"), tabBarIcon: ({ color, focused, size }) => <Icon name="library" filled={focused} color={color} size={size} /> }} />
        <Tabs.Screen name="(search)" options={{ title: t("shell.tabSearch"), tabBarIcon: ({ color, focused, size }) => <Icon name="search" filled={focused} color={color} size={size} /> }} />
        <Tabs.Screen name="(arena)" options={{ title: t("shell.tabGames"), tabBarIcon: ({ color, focused, size }) => <Icon name="arena" filled={focused} color={color} size={size} /> }} />
        <Tabs.Screen name="(you)" options={{ title: t("shell.tabYou"), tabBarIcon: ({ color, focused, size }) => <Icon name="profile" filled={focused} color={color} size={size} /> }} />
      </Tabs>
    </TabThemeContext.Provider>
  );
}

export default function AppLayout() {
  const t = useT();
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const returnTo = pathWithQuery(pathname, params);
  const { ready, user, unreachable, retry } = useAuth();
  const { colors } = useTheme();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", backgroundColor: colors.background, justifyContent: "center" }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }
  // Being unable to reach the server is not being signed out. Sending an
  // offline user to a login form asks them to re-enter a password they do not
  // need, and — before the retry below existed — stranded them there until the
  // app was killed and reopened.
  if (!user && unreachable) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: "center" }}>
        <ErrorState
          title={t("shell.serverUnreachableTitle")}
          body={t("shell.serverUnreachableBody")}
          actionLabel={t("shell.tryAgain")}
          onAction={() => void retry()}
        />
      </View>
    );
  }
  if (!user) return <Redirect href={{ pathname: "/login", params: { returnTo } }} />;
  // Google sign-in without a username yet — see choose-username.tsx's own
  // top comment, mirrors the PWA's RequireUsername guard.
  if (!user.username) return <Redirect href={{ pathname: "/choose-username", params: { returnTo } }} />;

  return <AppTabs />;
}
