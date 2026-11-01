import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { passwordHint, type AccountSecurity } from "@scripta/shared";
import { apiFetch } from "../api/client";
import { setAuthNotice } from "./returnTo";
import { setSession } from "./tokenStore";
import { PasswordInput } from "./PasswordInput";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_CLASS } from "../components/page/buttonClasses";
import { SettingGroup, SettingRow } from "../components/page/Page";
import { LIST_PANEL } from "../components/page/surfaceClasses";
import { useLocale, useT } from "../i18n";

const PASSWORD_FIELD = `${FIELD_CLASS} w-full`;

export function AccountSecuritySection() {
  const locale = useLocale();
  const t = useT();
  const account = useQuery({ queryKey: ["account-security"], queryFn: () => apiFetch("/auth/account") as Promise<AccountSecurity> });
  const [mode, setMode] = useState<"password" | "email" | null>(null);
  const [email, setEmail] = useState("");
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function sendVerification() {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await apiFetch("/auth/verification-email", { method: "POST", body: "{}" });
      setMessage(t("shell.verificationSent"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("shell.pleaseTryAgain")); }
    finally { setBusy(false); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(""); setMessage("");
    if (mode === "password" && password !== confirm) { setError(t("shell.passwordsDontMatch")); return; }
    setBusy(true);
    try {
      await apiFetch(mode === "password" ? "/auth/change-password" : "/auth/verification-email", { method: "POST", body: JSON.stringify({ currentPassword: current, password, email: mode === "email" ? email : undefined }) });
      if (mode === "password") { setAuthNotice(t("shell.passwordUpdatedLogInShort")); setSession(null); }
      else { setMessage(t("shell.emailChangeSent")); setMode(null); }
      setCurrent(""); setPassword(""); setConfirm("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("shell.pleaseTryAgain")); }
    finally { setBusy(false); }
  }

  return <SettingGroup title={t("shell.signInAndEmail")}><div className={LIST_PANEL}>
    {account.isPending ? <p className="px-4 py-3 text-sm">{t("shell.loadingAccount")}</p> : account.isError ? <div className="px-4 py-3"><button onClick={() => void account.refetch()} className={BUTTON_SECONDARY}>{t("shell.accountLoadFailed")}</button></div> : <>
      <SettingRow
        label={t("shell.email")}
        description={<>{account.data.email} · {account.data.emailVerified ? t("shell.verified") : t("shell.notVerified")}{!account.data.emailEnabled && <span className="block">{t("shell.emailDeliveryUnavailable")}</span>}</>}
      >
        {!account.data.emailVerified && <button disabled={busy || !account.data.emailEnabled} onClick={() => void sendVerification()} className={BUTTON_SECONDARY}>{t("shell.sendVerificationEmail")}</button>}
        {account.data.canChangeEmail && <button disabled={busy || !account.data.emailEnabled} className={BUTTON_SECONDARY} onClick={() => { setEmail(account.data.email); setMode("email"); setError(""); }}>{t("shell.correctEmail")}</button>}
      </SettingRow>
      <SettingRow label={t("shell.password")} description={account.data.hasPassword ? t("shell.passwordUsedWith") : t("shell.passwordManagedByGoogle")}>
        {account.data.hasPassword && <button disabled={busy} onClick={() => { setMode("password"); setError(""); }} className={BUTTON_SECONDARY}>{t("shell.changePassword")}</button>}
      </SettingRow>
    </>}
    {message && <p role="status" className="px-4 py-3 text-sm">{message}</p>}
    {error && <p role="alert" className="px-4 py-3 text-sm text-(--color-danger)">{error}</p>}
    {mode && <form onSubmit={submit} className="px-4 py-3"><fieldset disabled={busy} className="space-y-3 text-sm">
      <label className="block">{t("shell.currentPassword")}<PasswordInput className={PASSWORD_FIELD} required autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} /></label>
      {mode === "email" ? <label className="block">{t("shell.newEmail")}<input type="email" required autoComplete="email" className={`${FIELD_CLASS} w-full`} value={email} onChange={(event) => setEmail(event.target.value)} /></label> : <>
        <label className="block">{t("shell.newPassword")}<PasswordInput className={PASSWORD_FIELD} required minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><p className="text-xs">{passwordHint(locale)}</p>
        <label className="block">{t("shell.confirmNewPassword")}<PasswordInput className={PASSWORD_FIELD} required autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>
        <p className="text-xs">{t("shell.changePasswordSignsOut")}</p>
      </>}
      <div className="flex gap-4"><button className={BUTTON_PRIMARY}>{busy ? t("shell.saving") : mode === "email" ? t("shell.sendConfirmation") : t("shell.changePassword")}</button><button type="button" className={BUTTON_SECONDARY} onClick={() => { setMode(null); setCurrent(""); setPassword(""); setConfirm(""); }}>{t("shell.cancel")}</button></div>
    </fieldset></form>}
  </div></SettingGroup>;
}
