import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { Text } from "../ui/Text";
import { Redirect, router, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { passwordHint, type AccountSecurity } from "@scripta/shared";
import { apiClient } from "../core/api";
import { useAuth } from "../core/auth";
import { Button, Input, Screen, useToast } from "../ui";
import { spacing, typography, useTheme } from "../ui/theme";
import { useLocale, useT } from "../i18n";

export default function AccountSecurityPage() {
  const locale = useLocale();
  const t = useT();
  const { user, ready, signOut } = useAuth();
  const { colors } = useTheme();
  const { show } = useToast();
  const account = useQuery({ queryKey: ["account-security"], queryFn: () => apiClient.request<AccountSecurity>("/auth/account", { auth: true }), enabled: Boolean(user) });
  const [mode, setMode] = useState<"password" | "email" | null>(null);
  const [email, setEmail] = useState("");
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [message, setMessage] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [deleteError, setDeleteError] = useState("");
  if (ready && !user) return <Redirect href={{ pathname: "/login", params: { returnTo: "/account-security" } }} />;

  async function run(action: "verify" | "password" | "email") {
    if (busy) return;
    setError(""); setMessage(""); setConfirmError("");
    if (action === "password" && password !== confirm) { setConfirmError(t("shell.passwordsMismatch")); return; }
    setBusy(true);
    try {
      await apiClient.request(action === "password" ? "/auth/change-password" : "/auth/verification-email", {
        method: "POST", auth: true, body: action === "verify" ? {} : { currentPassword: current, password, email: action === "email" ? email : undefined },
      });
      if (action === "password") { await signOut(); router.replace({ pathname: "/login", params: { notice: "password-changed" } }); }
      else { setMessage(action === "email" ? t("shell.checkNewAddress") : t("shell.checkInbox")); setMode(null); }
      setCurrent(""); setPassword(""); setConfirm("");
    } catch (reason) { setError(reason instanceof TypeError ? t("shell.connectFailedShort") : reason instanceof Error ? reason.message : t("shell.pleaseTryAgain")); }
    finally { setBusy(false); }
  }

  async function deleteAccount() {
    if (busy) return;
    setDeleteError(""); setBusy(true);
    try {
      await apiClient.request("/auth/delete-account", { method: "POST", auth: true, body: account.data?.hasPassword ? { password: confirmation } : { confirmation } });
      await signOut();
      router.replace("/login");
      show(t("shell.accountDeleted"), "success");
    } catch (reason) { setDeleteError(reason instanceof TypeError ? t("shell.connectFailedShort") : reason instanceof Error ? reason.message : t("shell.pleaseTryAgain")); }
    finally { setBusy(false); }
  }

  return <Screen top={false} bottom><Stack.Screen options={{ headerShown: true, title: t("shell.account") }} />
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}>
        {account.isPending ? <Text style={{ color: colors.text }}>{t("shell.accountLoading")}</Text> : account.isError ? <Button label={t("shell.accountLoadFailed")} onPress={() => void account.refetch()} /> : <>
          <Text selectable style={[typography.body, { color: colors.text }]}>{t(account.data.emailVerified ? "shell.accountEmailVerified" : "shell.accountEmailNotVerified", { email: account.data.email })}</Text>
          {!account.data.emailEnabled && <Text style={{ color: colors.textDim }}>{t("shell.emailDeliveryUnavailable")}</Text>}
          {!mode && !account.data.emailVerified && <Button label={t("shell.sendVerificationEmail")} variant="secondary" disabled={busy || !account.data.emailEnabled} onPress={() => void run("verify")} />}
          {account.data.hasPassword ? <Button label={t("shell.changePassword")} variant="secondary" disabled={busy} onPress={() => { setMode("password"); setError(""); setConfirmError(""); }} /> : <Text style={{ color: colors.textDim }}>{t("shell.passwordManagedByGoogle")}</Text>}
          {account.data.canChangeEmail && <Button label={t("shell.correctEmail")} variant="secondary" disabled={busy || !account.data.emailEnabled} onPress={() => { setEmail(account.data.email); setMode("email"); setError(""); setConfirmError(""); }} />}
        </>}
        {message ? <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{message}</Text> : null}
        {!mode && error ? <Text accessibilityRole="alert" selectable style={{ color: colors.danger }}>{error}</Text> : null}
        {mode && <View style={{ gap: spacing.md }}>
          <Input label={t("shell.currentPassword")} secureTextEntry autoComplete="current-password" textContentType="password" value={current} onChangeText={setCurrent} editable={!busy} />
          {mode === "email" ? <Input label={t("shell.newEmail")} autoComplete="email" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" value={email} onChangeText={setEmail} editable={!busy} /> : <>
            <Input label={t("shell.newPassword")} secureTextEntry autoComplete="new-password" textContentType="newPassword" hint={passwordHint(locale)} value={password} onChangeText={setPassword} editable={!busy} />
            <Input label={t("shell.confirmNewPassword")} secureTextEntry autoComplete="new-password" textContentType="newPassword" error={confirmError} value={confirm} onChangeText={(value) => { setConfirm(value); setConfirmError(""); }} editable={!busy} />
            <Text style={{ color: colors.textDim }}>{t("shell.changePasswordNotice")}</Text>
          </>}
          {error ? <Text accessibilityRole="alert" selectable style={{ color: colors.danger }}>{error}</Text> : null}
          <Button label={mode === "email" ? t("shell.sendConfirmation") : t("shell.saveNewPassword")} loading={busy} onPress={() => void run(mode)} />
          <Button label={t("shell.cancel")} variant="secondary" disabled={busy} onPress={() => { setMode(null); setError(""); setConfirmError(""); setCurrent(""); setPassword(""); setConfirm(""); }} />
        </View>}
        {account.data && <View style={{ gap: spacing.md, marginTop: spacing.xl }}>
          <Text accessibilityRole="header" style={[typography.title, { color: colors.text }]}>{t("shell.deleteAccount")}</Text>
          <Text style={[typography.body, { color: colors.textDim }]}>{t("shell.deleteAccountWarning")}</Text>
          {!deleting ? <Button label={t("shell.deleteAccountEllipsis")} variant="destructive" disabled={busy} onPress={() => { setDeleting(true); setDeleteError(""); }} /> : <>
            {account.data.hasPassword
              ? <Input label={t("shell.deleteEnterPassword")} secureTextEntry autoComplete="current-password" textContentType="password" value={confirmation} onChangeText={setConfirmation} editable={!busy} />
              : <Input label={t("shell.deleteTypeToConfirm", { name: user?.username ?? account.data.email })} autoCapitalize="none" autoCorrect={false} value={confirmation} onChangeText={setConfirmation} editable={!busy} />}
            {deleteError ? <Text accessibilityRole="alert" selectable style={{ color: colors.danger }}>{deleteError}</Text> : null}
            <Button label={t("shell.deleteMyAccount")} variant="destructive" loading={busy} disabled={!confirmation} onPress={() => void deleteAccount()} />
            <Button label={t("shell.cancel")} variant="secondary" disabled={busy} onPress={() => { setDeleting(false); setConfirmation(""); setDeleteError(""); }} />
          </>}
        </View>}
      </ScrollView>
    </KeyboardAvoidingView>
  </Screen>;
}
