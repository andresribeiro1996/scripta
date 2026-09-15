import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { RECOVERY_MESSAGE } from "@scripta/shared";
import { apiClient } from "../core/api";
import { Button, Input, Screen } from "../ui";
import { spacing, typography, useTheme } from "../ui/theme";

export default function ForgotPassword() {
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? "");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const { colors } = useTheme();
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  async function submit() {
    if (busy || cooldown > 0) return;
    setBusy(true); setError("");
    try {
      await apiClient.request("/auth/forgot-password", { method: "POST", body: { email: email.trim() } });
      setSent(true); setCooldown(60);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn’t connect. Please try again."); }
    finally { setBusy(false); }
  }
  return <Screen top={false} bottom><Stack.Screen options={{ headerShown: true, title: "Recover account" }} />
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}>
        <Text style={[typography.body, { color: colors.textDim }]}>Enter your account’s email address. We’ll send a link that opens securely in your browser.</Text>
        {sent && <Text accessibilityLiveRegion="polite" style={[typography.body, { color: colors.text }]}>{RECOVERY_MESSAGE}</Text>}
        <Input label="Email" autoComplete="email" textContentType="emailAddress" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" value={email} onChangeText={(value) => { setEmail(value); setSent(false); }} editable={!busy} returnKeyType="send" onSubmitEditing={() => void submit()} />
        {error ? <Text accessibilityRole="alert" selectable style={{ color: colors.danger }}>{error}</Text> : null}
        <View><Button label={cooldown ? `Resend in ${cooldown}s` : sent ? "Resend email" : "Send recovery email"} loading={busy} disabled={cooldown > 0 || !email.trim()} onPress={() => void submit()} /></View>
        <Button label="Back to login" variant="secondary" onPress={() => router.replace("/login")} />
      </ScrollView>
    </KeyboardAvoidingView>
  </Screen>;
}
