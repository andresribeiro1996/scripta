import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { Text } from "../ui/Text";
import { Redirect, router, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { PASSWORD_HINT, type AccountSecurity } from "@scripta/shared";
import { apiClient } from "../core/api";
import { useAuth } from "../core/auth";
import { Button, Input, Screen } from "../ui";
import { spacing, typography, useTheme } from "../ui/theme";

export default function AccountSecurityPage() {
  const { user, ready, signOut } = useAuth();
  const { colors } = useTheme();
  const account = useQuery({ queryKey: ["account-security"], queryFn: () => apiClient.request<AccountSecurity>("/auth/account", { auth: true }), enabled: Boolean(user) });
  const [mode, setMode] = useState<"password" | "email" | null>(null);
  const [email, setEmail] = useState("");
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [deleteError, setDeleteError] = useState("");
  if (ready && !user) return <Redirect href={{ pathname: "/login", params: { returnTo: "/account-security" } }} />;

  async function run(action: "verify" | "password" | "email") {
    if (busy) return;
    setError(""); setMessage("");
    if (action === "password" && password !== confirm) { setError("Passwords don’t match."); return; }
    setBusy(true);
    try {
      await apiClient.request(action === "password" ? "/auth/change-password" : "/auth/verification-email", {
        method: "POST", auth: true, body: action === "verify" ? {} : { currentPassword: current, password, email: action === "email" ? email : undefined },
      });
      if (action === "password") { await signOut(); router.replace({ pathname: "/login", params: { notice: "password-changed" } }); }
      else { setMessage(action === "email" ? "Check the new address to confirm it. Your current email stays active until then." : "Check your inbox and spam folder. You can resend in a minute."); setMode(null); }
      setCurrent(""); setPassword(""); setConfirm("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Please try again."); }
    finally { setBusy(false); }
  }

  async function deleteAccount() {
    if (busy) return;
    setDeleteError(""); setBusy(true);
    try {
      await apiClient.request("/auth/delete-account", { method: "POST", auth: true, body: account.data?.hasPassword ? { password: confirmation } : { confirmation } });
      await signOut();
      router.replace("/login");
      Alert.alert("Account deleted", "Your account and everything in it have been deleted.");
    } catch (reason) { setDeleteError(reason instanceof Error ? reason.message : "Please try again."); }
    finally { setBusy(false); }
  }

  return <Screen top={false} bottom><Stack.Screen options={{ headerShown: true, title: "Account" }} />
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}>
        {account.isPending ? <Text style={{ color: colors.text }}>Loading account…</Text> : account.isError ? <Button label="Couldn’t load account. Try again" onPress={() => void account.refetch()} /> : <>
          <Text selectable style={[typography.body, { color: colors.text }]}>{account.data.email} · {account.data.emailVerified ? "Verified" : "Not verified"}</Text>
          {!account.data.emailEnabled && <Text style={{ color: colors.textDim }}>Email delivery is temporarily unavailable.</Text>}
          {!account.data.emailVerified && <Button label="Send verification email" variant="secondary" disabled={busy || !account.data.emailEnabled} onPress={() => void run("verify")} />}
          {account.data.hasPassword ? <Button label="Change password" variant="secondary" disabled={busy} onPress={() => { setMode("password"); setError(""); }} /> : <Text style={{ color: colors.textDim }}>Your password is managed by Google.</Text>}
          {account.data.canChangeEmail && <Button label="Correct email" variant="secondary" disabled={busy || !account.data.emailEnabled} onPress={() => { setEmail(account.data.email); setMode("email"); setError(""); }} />}
        </>}
        {message ? <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{message}</Text> : null}
        {error ? <Text accessibilityRole="alert" selectable style={{ color: colors.danger }}>{error}</Text> : null}
        {mode && <View style={{ gap: spacing.md }}>
          <Input label="Current password" secureTextEntry autoComplete="current-password" textContentType="password" value={current} onChangeText={setCurrent} editable={!busy} />
          {mode === "email" ? <Input label="New email" autoComplete="email" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" value={email} onChangeText={setEmail} editable={!busy} /> : <>
            <Input label="New password" secureTextEntry autoComplete="new-password" textContentType="newPassword" hint={PASSWORD_HINT} value={password} onChangeText={setPassword} editable={!busy} />
            <Input label="Confirm new password" secureTextEntry autoComplete="new-password" textContentType="newPassword" value={confirm} onChangeText={setConfirm} editable={!busy} />
            <Text style={{ color: colors.textDim }}>Changing your password signs you out on every device. Then log in with your new password.</Text>
          </>}
          <Button label={mode === "email" ? "Send confirmation" : "Save new password"} loading={busy} onPress={() => void run(mode)} />
          <Button label="Cancel" variant="secondary" disabled={busy} onPress={() => { setMode(null); setCurrent(""); setPassword(""); setConfirm(""); }} />
        </View>}
        {account.data && <View style={{ gap: spacing.md, marginTop: spacing.xl }}>
          <Text accessibilityRole="header" style={[typography.title, { color: colors.text }]}>Delete account</Text>
          <Text style={[typography.body, { color: colors.textDim }]}>Permanently deletes your account and everything in it: your library and highlights, murals, gallery images, tier lists, tournaments, follows and connected accounts. Share links stop working. This can’t be undone.</Text>
          {!deleting ? <Button label="Delete account…" variant="destructive" disabled={busy} onPress={() => { setDeleting(true); setDeleteError(""); }} /> : <>
            {account.data.hasPassword
              ? <Input label="Enter your password to confirm" secureTextEntry autoComplete="current-password" textContentType="password" value={confirmation} onChangeText={setConfirmation} editable={!busy} />
              : <Input label={`Type ${user?.username ?? account.data.email} to confirm`} autoCapitalize="none" autoCorrect={false} value={confirmation} onChangeText={setConfirmation} editable={!busy} />}
            {deleteError ? <Text accessibilityRole="alert" selectable style={{ color: colors.danger }}>{deleteError}</Text> : null}
            <Button label="Delete my account" variant="destructive" loading={busy} disabled={!confirmation} onPress={() => void deleteAccount()} />
            <Button label="Cancel" variant="secondary" disabled={busy} onPress={() => { setDeleting(false); setConfirmation(""); setDeleteError(""); }} />
          </>}
        </View>}
      </ScrollView>
    </KeyboardAvoidingView>
  </Screen>;
}
