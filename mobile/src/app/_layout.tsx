import { useEffect, useRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LibrarySaver } from "@scripta/shared";
import { useFonts } from "expo-font";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { AuthProvider, useAuth } from "../core/auth";
import { createAccountLibrarySaver, LibrarySaverContext } from "../features/library/hooks/useLibrary";
import { FONT_ASSETS } from "../ui/fontAssets";
import { ThemeProvider, useTheme } from "../ui/theme";
import { useScreenOptions } from "../ui/navigation";

void SplashScreen.preventAutoHideAsync();

function AccountRoutes() {
  const { user } = useAuth();
  const userId = user?.id;
  const account = useRef<{ userId: string | undefined; queryClient: QueryClient; saver: LibrarySaver } | null>(null);
  if (!account.current || account.current.userId !== userId) {
    account.current?.saver.dispose();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } });
    account.current = { userId, queryClient, saver: createAccountLibrarySaver(queryClient) };
  }
  const { queryClient, saver } = account.current;
  return (
    <QueryClientProvider key={userId ?? "public"} client={queryClient}>
      <LibrarySaverContext.Provider value={saver}>
        <ThemedStatusBar />
        <RootStack />
      </LibrarySaverContext.Provider>
    </QueryClientProvider>
  );
}

// Inside ThemeProvider so the bar contrasts with whichever palette is live —
// a fixed `style="dark"` renders dark glyphs on the dark background.
function ThemedStatusBar() {
  const { mode } = useTheme();
  return <StatusBar style={mode === "dark" ? "light" : "dark"} />;
}

// Also inside ThemeProvider, so the routes that do show a header (gallery, the
// public arena, the shared-link screens) get the same themed chrome as the tab
// stacks. Headers stay off by default: most root routes are full-bleed.
function RootStack() {
  return <Stack screenOptions={{ ...useScreenOptions(), headerShown: false }} />;
}

function HideSplash() {
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);
  return null;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);
  useEffect(() => {
    if (fontError) console.warn("Couldn't load the bundled fonts; using system fonts.", fontError);
  }, [fontError]);
  if (!fontsLoaded && !fontError) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
          <ThemeProvider bundledFonts={fontsLoaded}>
            <HideSplash />
            <AuthProvider>
              <AccountRoutes />
            </AuthProvider>
          </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
