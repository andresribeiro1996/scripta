import { authDestination, startAuthNavigation } from "../features/auth/navigation";
import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import { Text } from "../ui/Text";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useAuth } from "../core/auth";
import { Button, Input, Screen } from "../ui";
import { spacing, typography, useTheme } from "../ui/theme";
import { useT } from "../i18n";

/** A Google sign-in with no username yet (`user.username === null`) is
 *  routed here by (app)/_layout.tsx's own guard before it's treated as
 *  fully signed in — the mobile equivalent of the PWA's RequireUsername
 *  (see backend/README's auth section: "the caller is expected to prompt
 *  for one via POST /auth/username before treating the account as fully
 *  set up"). A top-level route, not nested under (app)'s Tabs, so it
 *  never shows up as a tab. */
export default function ChooseUsernamePage() {
  const t = useT();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { ready, user, setUsername } = useAuth();
  const { colors } = useTheme();
  const [continueToAvatar, setContinueToAvatar] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ready) {
    return (
      <Screen bottom style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </Screen>
    );
  }
  if (!user) return <Redirect href="/(public)/login" />;
  if (user.username) return <Redirect href={(continueToAvatar ? "/welcome-avatar" : authDestination()) as never} withAnchor={!continueToAvatar} />;

  const trimmed = value.trim();
  const tooShort = trimmed.length < 3;
  const onSubmit = async () => {
    if (busy) return;
    startAuthNavigation(returnTo ?? authDestination(), true);
    setBusy(true);
    setError(null);
    setContinueToAvatar(true);
    try {
      await setUsername(trimmed);
    } catch (e) {
      setError(e instanceof TypeError ? t("shell.connectFailedShort") : e instanceof Error ? e.message : t("shell.usernameSaveFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen bottom>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.flex}>
        <View style={styles.center}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{t("shell.chooseUsername")}</Text>
          <Text style={[styles.sub, { color: colors.textDim }]}>{t("shell.chooseUsernameHint")}</Text>
          <View style={styles.form}>
            <Input
              label={t("shell.username")}
              value={value}
              onChangeText={setValue}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username-new"
              textContentType="username"
              returnKeyType="done"
              onSubmitEditing={() => { if (!tooShort && !busy) void onSubmit(); }}
              placeholder={t("shell.usernamePlaceholder")}
              error={error ?? undefined}
            />
            <Button label={t("shell.continue")} loading={busy} disabled={tooShort} onPress={() => void onSubmit()} />
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
