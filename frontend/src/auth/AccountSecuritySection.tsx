import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { PASSWORD_HINT, type AccountSecurity } from "@scripta/shared";
import { apiFetch } from "../api/client";
import { setSession } from "./tokenStore";
import { PasswordInput } from "./PasswordInput";

export function AccountSecuritySection() {
  const navigate = useNavigate();
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
      if (mode === "password") { navigate("/login", { replace: true, state: { message: "Password updated. Log in with your new password." } }); setSession(null); }
      else { setMessage("Check the new address to confirm it. Your current email stays active until then."); setMode(null); }
      setCurrent(""); setPassword(""); setConfirm("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Please try again."); }
    finally { setBusy(false); }
  }

  return <section className="mt-5 space-y-4 rounded-xl border border-(--color-border) bg-(--color-surface) p-5">
    <h3 className="text-sm font-semibold">Password and email</h3>
    {account.isPending ? <p>Loading account…</p> : account.isError ? <button onClick={() => void account.refetch()}>Couldn’t load account. Try again</button> : <>
      <p className="text-sm">{account.data.email} · {account.data.emailVerified ? "Verified" : "Not verified"}</p>
      {!account.data.emailEnabled && <p className="text-sm text-(--color-text-dim)">Email delivery is temporarily unavailable.</p>}
      <div className="flex flex-wrap gap-4 text-sm text-(--color-accent)">
        {!account.data.emailVerified && <button disabled={busy || !account.data.emailEnabled} onClick={() => void sendVerification()}>Send verification email</button>}
        {account.data.hasPassword ? <button disabled={busy} onClick={() => { setMode("password"); setError(""); }}>Change password</button> : <p>Your password is managed by Google.</p>}
        {account.data.canChangeEmail && <button disabled={busy || !account.data.emailEnabled} onClick={() => { setEmail(account.data.email); setMode("email"); setError(""); }}>Correct email</button>}
      </div>
    </>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {error && <p role="alert" className="text-sm text-(--color-danger)">{error}</p>}
    {mode && <form onSubmit={submit}><fieldset disabled={busy} className="space-y-3 text-sm">
      <label className="block">Current password<PasswordInput required autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} /></label>
      {mode === "email" ? <label className="block">New email<input type="email" required autoComplete="email" className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) p-3" value={email} onChange={(event) => setEmail(event.target.value)} /></label> : <>
        <label className="block">New password<PasswordInput required minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><p className="text-xs">{PASSWORD_HINT}</p>
        <label className="block">Confirm new password<PasswordInput required autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>
        <p className="text-xs">Changing your password signs you out on every device.</p>
      </>}
      <div className="flex gap-4"><button className="rounded-lg bg-(--color-accent) px-4 py-3 text-(--color-bg)">{busy ? "Saving…" : mode === "email" ? "Send confirmation" : "Change password"}</button><button type="button" onClick={() => { setMode(null); setCurrent(""); setPassword(""); setConfirm(""); }}>Cancel</button></div>
    </fieldset></form>}
  </section>;
}
