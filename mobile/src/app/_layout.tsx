import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "../core/auth";
import { ThemeProvider, useTheme } from "../ui/theme";
import { useScreenOptions } from "../ui/navigation";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

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

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <AuthProvider>
              <ThemedStatusBar />
              <RootStack />
            </AuthProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
