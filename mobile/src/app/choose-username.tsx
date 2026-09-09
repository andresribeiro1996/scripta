import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from "react-native";
import { Redirect } from "expo-router";
import { useAuth } from "../core/auth";
import { Button, Input, Screen } from "../ui";
import { spacing, typography, useTheme } from "../ui/theme";

/** A Google sign-in with no username yet (`user.username === null`) is
 *  routed here by (app)/_layout.tsx's own guard before it's treated as
 *  fully signed in — the mobile equivalent of the PWA's RequireUsername
 *  (see backend/README's auth section: "the caller is expected to prompt
 *  for one via POST /auth/username before treating the account as fully
 *  set up"). A top-level route, not nested under (app)'s Tabs, so it
 *  never shows up as a tab. */
export default function ChooseUsernamePage() {
  const { ready, user, setUsername } = useAuth();
  const { colors } = useTheme();
  const [continueToAvatar, setContinueToAvatar] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ready) {
    return (
      <Screen bottomInset style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </Screen>
    );
  }
  if (!user) return <Redirect href="/(public)/login" />;
  if (user.username) return <Redirect href={continueToAvatar ? "/welcome-avatar" : "/(app)"} />;

  const trimmed = value.trim();
  const tooShort = trimmed.length < 3;
  const onSubmit = async () => {
    setBusy(true);
    setError(null);
    setContinueToAvatar(true);
    try {
      await setUsername(trimmed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that username");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen bottomInset>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <View style={styles.center}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Choose a username</Text>
          <Text style={[styles.sub, { color: colors.textDim }]}>One more step before your library loads.</Text>
          <View style={styles.form}>
            <Input
              label="Username"
              value={value}
              onChangeText={setValue}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username-new"
              textContentType="username"
              returnKeyType="done"
              onSubmitEditing={() => { if (!tooShort && !busy) void onSubmit(); }}
              placeholder="username"
              error={error ?? undefined}
            />
            <Button label="Continue" loading={busy} disabled={tooShort} onPress={() => void onSubmit()} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: spacing.xxl, gap: spacing.xs },
  title: { ...typography.heading, fontWeight: "700" },
  sub: { ...typography.body, marginBottom: spacing.xxl, textAlign: "center" },
  form: { width: "100%", gap: spacing.md },
});
