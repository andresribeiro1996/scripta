import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { passwordHint, recoveryMessage } from "@scripta/shared";
import { publicFetch } from "../api/client";
import { setSession } from "../auth/tokenStore";
import { PasswordInput } from "../auth/PasswordInput";
import { AuthCard, AuthHeading, AuthServerError, AuthStage, authFieldClass, authHintClass, authLabelClass, authLinkClass, authSubmitClass } from "../auth/AuthStage";
import { useLocale, useT } from "../i18n";

export function AccountActionPage({ action }: { action: "forgot" | "reset" | "verify" }) {
  const locale = useLocale();
  const t = useT();
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
    if (action === "reset" && password !== confirm) { setError(t("shell.passwordsDontMatch")); return; }
    setBusy(true);
    try {
      await publicFetch(`/auth/${action === "forgot" ? "forgot-password" : action === "reset" ? "reset-password" : "verify-email"}`, {
        method: "POST", body: JSON.stringify(action === "forgot" ? { email: email.trim() } : { token, password }),
      });
      if (action === "reset") {
        navigate("/login", { replace: true, state: { message: t("shell.passwordUpdatedLogIn") } });
        setSession(null);
        return;
      }
      setDone(true);
      setPassword("");
      setConfirm("");
      if (action === "forgot") setCooldown(60);
    } catch (reason) { setError(reason instanceof TypeError ? t("shell.connectFailed") : reason instanceof Error ? reason.message : t("shell.pleaseTryAgain")); }
    finally { setBusy(false); }
  }

  return <AuthStage><AuthCard>
    <AuthHeading title={action === "forgot" ? t("shell.recoverTitle") : action === "reset" ? t("shell.resetTitle") : t("shell.verifyTitle")} subtitle={action === "forgot" ? t("shell.recoverSubtitle") : undefined} />
    <AuthServerError message={error} />
    {done && <p role="status" className="mb-5 text-center text-sm">{action === "forgot" ? recoveryMessage(locale) : action === "reset" ? t("shell.resetDone") : t("shell.verifyDone")}</p>}
    {(!done || action === "forgot") && <form onSubmit={submit} className="space-y-4">
      <fieldset disabled={busy} className="space-y-4">
        {action === "forgot" ? <div><label htmlFor="recovery-email" className={authLabelClass}>{t("shell.email")}</label><input id="recovery-email" type="email" required autoComplete="email" autoCapitalize="none" value={email} onChange={(event) => { setEmail(event.target.value); setDone(false); }} className={authFieldClass} /></div> : action === "reset" && token ? <>
          <div><label htmlFor="new-password" className={authLabelClass}>{t("shell.newPassword")}</label><PasswordInput id="new-password" required minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className={authFieldClass} /><p className={authHintClass}>{passwordHint(locale)}</p></div>
          <div><label htmlFor="confirm-password" className={authLabelClass}>{t("shell.confirmNewPassword")}</label><PasswordInput id="confirm-password" required autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} className={authFieldClass} /></div>
        </> : !token ? <p role="alert" className="text-center text-sm">{action === "reset" ? t("shell.missingResetCode") : t("shell.missingVerifyCode")}</p> : <p className="text-center text-sm">{t("shell.confirmEmailPrompt")}</p>}
        {(action === "forgot" || token) && <button className={authSubmitClass} disabled={busy || (action === "forgot" && cooldown > 0)}>{busy ? t("shell.working") : action === "forgot" ? cooldown > 0 ? t("shell.resendIn", { seconds: cooldown }) : done ? t("shell.resendEmail") : t("shell.sendRecoveryEmail") : action === "reset" ? t("shell.updatePassword") : t("shell.verifyEmail")}</button>}
      </fieldset>
    </form>}
    <div className="mt-4 flex flex-col items-center gap-2 text-center text-sm">
      {action === "reset" && !done && <Link to="/forgot-password" className={`flex min-h-11 items-center ${authLinkClass}`}>{t("shell.requestNewReset")}</Link>}
      {action === "verify" && <Link to="/dashboard/settings" className={`flex min-h-11 items-center ${authLinkClass}`}>{t("shell.openSettingsForEmail")}</Link>}
      <Link to="/login" className={`flex min-h-11 items-center ${authLinkClass}`}>{t("shell.backToLogin")}</Link>
    </div>
  </AuthCard></AuthStage>;
}
