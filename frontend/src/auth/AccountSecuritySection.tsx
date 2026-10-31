import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PASSWORD_HINT, type AccountSecurity } from "@scripta/shared";
import { apiFetch } from "../api/client";
import { setAuthNotice } from "./returnTo";
import { setSession } from "./tokenStore";
import { PasswordInput } from "./PasswordInput";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_CLASS } from "../components/page/buttonClasses";
import { SettingGroup, SettingRow } from "../components/page/Page";
import { LIST_PANEL } from "../components/page/surfaceClasses";

const PASSWORD_FIELD = `${FIELD_CLASS} w-full`;

export function AccountSecuritySection() {
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
      setMessage("Check your inbox and spam folder. You can resend in a minute.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Please try again."); }
    finally { setBusy(false); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(""); setMessage("");
    if (mode === "password" && password !== confirm) { setError("Passwords don’t match."); return; }
    setBusy(true);
    try {
      await apiFetch(mode === "password" ? "/auth/change-password" : "/auth/verification-email", { method: "POST", body: JSON.stringify({ currentPassword: current, password, email: mode === "email" ? email : undefined }) });
      if (mode === "password") { setAuthNotice("Password updated. Log in with your new password."); setSession(null); }
      else { setMessage("Check the new address to confirm it. Your current email stays active until then."); setMode(null); }
      setCurrent(""); setPassword(""); setConfirm("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Please try again."); }
    finally { setBusy(false); }
  }

  return <SettingGroup title="Sign-in and email"><div className={LIST_PANEL}>
    {account.isPending ? <p className="px-4 py-3 text-sm">Loading account…</p> : account.isError ? <div className="px-4 py-3"><button onClick={() => void account.refetch()} className={BUTTON_SECONDARY}>Couldn’t load account. Try again</button></div> : <>
      <SettingRow
        label="Email"
        description={<>{account.data.email} · {account.data.emailVerified ? "Verified" : "Not verified"}{!account.data.emailEnabled && <span className="block">Email delivery is temporarily unavailable.</span>}</>}
      >
        {!account.data.emailVerified && <button disabled={busy || !account.data.emailEnabled} onClick={() => void sendVerification()} className={BUTTON_SECONDARY}>Send verification email</button>}
        {account.data.canChangeEmail && <button disabled={busy || !account.data.emailEnabled} className={BUTTON_SECONDARY} onClick={() => { setEmail(account.data.email); setMode("email"); setError(""); }}>Correct email</button>}
      </SettingRow>
      <SettingRow label="Password" description={account.data.hasPassword ? "Used with your email or username" : "Your password is managed by Google."}>
        {account.data.hasPassword && <button disabled={busy} onClick={() => { setMode("password"); setError(""); }} className={BUTTON_SECONDARY}>Change password</button>}
      </SettingRow>
    </>}
    {message && <p role="status" className="px-4 py-3 text-sm">{message}</p>}
    {error && <p role="alert" className="px-4 py-3 text-sm text-(--color-danger)">{error}</p>}
    {mode && <form onSubmit={submit} className="px-4 py-3"><fieldset disabled={busy} className="space-y-3 text-sm">
      <label className="block">Current password<PasswordInput className={PASSWORD_FIELD} required autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} /></label>
      {mode === "email" ? <label className="block">New email<input type="email" required autoComplete="email" className={`${FIELD_CLASS} w-full`} value={email} onChange={(event) => setEmail(event.target.value)} /></label> : <>
        <label className="block">New password<PasswordInput className={PASSWORD_FIELD} required minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><p className="text-xs">{PASSWORD_HINT}</p>
        <label className="block">Confirm new password<PasswordInput className={PASSWORD_FIELD} required autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>
        <p className="text-xs">Changing your password signs you out on every device.</p>
      </>}
      <div className="flex gap-4"><button className={BUTTON_PRIMARY}>{busy ? "Saving…" : mode === "email" ? "Send confirmation" : "Change password"}</button><button type="button" className={BUTTON_SECONDARY} onClick={() => { setMode(null); setCurrent(""); setPassword(""); setConfirm(""); }}>Cancel</button></div>
    </fieldset></form>}
  </div></SettingGroup>;
}
