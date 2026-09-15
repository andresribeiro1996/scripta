import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { PASSWORD_HINT, RECOVERY_MESSAGE } from "@scripta/shared";
import { publicFetch } from "../api/client";
import { setSession } from "../auth/tokenStore";
import { PasswordInput } from "../auth/PasswordInput";
import { AuthBrandHeading, AuthCard, AuthServerError, AuthStage, authFieldClass, authLabelClass, authSubmitClass, GOLD, INK, PAPER } from "../auth/AuthStage";

export function AccountActionPage({ action }: { action: "forgot" | "reset" | "verify" }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [token] = useState(() => new URLSearchParams(location.hash.slice(1)).get("token") ?? "");
  const [email, setEmail] = useState(() => new URLSearchParams(location.search).get("email") ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (location.hash) window.history.replaceState(null, "", location.pathname); }, [location.hash, location.pathname]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || (action === "forgot" && cooldown > 0)) return;
    setError(null);
    if (action === "reset" && password !== confirm) { setError("Passwords don’t match."); return; }
    setBusy(true);
    try {
      await publicFetch(`/auth/${action === "forgot" ? "forgot-password" : action === "reset" ? "reset-password" : "verify-email"}`, {
        method: "POST", body: JSON.stringify(action === "forgot" ? { email: email.trim() } : { token, password }),
      });
      if (action === "reset") {
        navigate("/login", { replace: true, state: { message: "Password updated. Log in with your new password. All other sessions were signed out." } });
        setSession(null);
        return;
      }
      setDone(true);
      setPassword("");
      setConfirm("");
      if (action === "forgot") setCooldown(60);
    } catch (reason) { setError(reason instanceof TypeError ? "Couldn’t connect. Check your connection and try again." : reason instanceof Error ? reason.message : "Please try again."); }
    finally { setBusy(false); }
  }

  return <AuthStage><AuthCard><div style={{ color: PAPER }}>
    <AuthBrandHeading subtitle={action === "forgot" ? "Recover your account" : action === "reset" ? "Choose a new password" : "Verify your email"} />
    <AuthServerError message={error} />
    {done && <p role="status" className="mb-5 text-sm">{action === "forgot" ? RECOVERY_MESSAGE : action === "reset" ? "Password updated. Log in with your new password. Your other sessions have been signed out." : "Email verified. You can return to Scripta. If you changed your email, log in with the new address."}</p>}
    {(!done || action === "forgot") && <form onSubmit={submit} className="space-y-4">
      <fieldset disabled={busy} className="space-y-4">
        {action === "forgot" ? <div><label htmlFor="recovery-email" className={authLabelClass}>Email</label><input id="recovery-email" type="email" required autoComplete="email" autoCapitalize="none" value={email} onChange={(event) => { setEmail(event.target.value); setDone(false); }} className={authFieldClass} /></div> : action === "reset" && token ? <>
          <div><label htmlFor="new-password" className={authLabelClass}>New password</label><PasswordInput id="new-password" required minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className={authFieldClass} /><p className="mt-2 text-xs">{PASSWORD_HINT}</p></div>
          <div><label htmlFor="confirm-password" className={authLabelClass}>Confirm new password</label><PasswordInput id="confirm-password" required autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} className={authFieldClass} /></div>
        </> : !token ? <p role="alert" className="text-sm">This link is missing its verification code. Request a new email.</p> : <p className="text-sm">Confirm this email address for your Scripta account.</p>}
        {(action === "forgot" || token) && <button className={authSubmitClass} style={{ backgroundColor: GOLD, color: INK }} disabled={busy || (action === "forgot" && cooldown > 0)}>{busy ? "Working…" : action === "forgot" ? cooldown > 0 ? `Resend in ${cooldown}s` : done ? "Resend email" : "Send recovery email" : action === "reset" ? "Update password" : "Verify email"}</button>}
      </fieldset>
    </form>}
    {action === "reset" && !done && <Link to="/forgot-password" className="mt-4 block text-sm underline">Request a new reset link</Link>}
    {action === "verify" && <Link to="/dashboard/settings" className="mt-4 block text-sm underline">Open Settings to resend or correct your email</Link>}
    <Link to="/login" className="mt-5 block text-center text-sm underline">Back to login</Link>
  </div></AuthCard></AuthStage>;
}
