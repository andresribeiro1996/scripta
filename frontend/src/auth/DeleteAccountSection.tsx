import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AccountSecurity } from "@scripta/shared";
import { apiFetch } from "../api/client";
import { BUTTON_DANGER, BUTTON_DANGER_OUTLINE, BUTTON_SECONDARY, FIELD_CLASS } from "../components/page/buttonClasses";
import { SettingGroup, SettingRow } from "../components/page/Page";
import { LIST_PANEL } from "../components/page/surfaceClasses";
import { useAuth } from "./AuthContext";
import { setAuthNotice } from "./returnTo";
import { setSession } from "./tokenStore";
import { PasswordInput } from "./PasswordInput";

export function DeleteAccountSection() {
  const { session } = useAuth();
  const account = useQuery({ queryKey: ["account-security"], queryFn: () => apiFetch("/auth/account") as Promise<AccountSecurity> });
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const hasPassword = account.data?.hasPassword ?? true;
  const name = session?.user.username ?? account.data?.email ?? "";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      await apiFetch("/auth/delete-account", { method: "POST", body: JSON.stringify(hasPassword ? { password: value } : { confirmation: value }) });
      setAuthNotice("Your account and everything in it have been deleted.");
      setSession(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Please try again."); }
    finally { setBusy(false); }
  }

  return <SettingGroup title="Delete account"><div className={LIST_PANEL}>
    <SettingRow label="Delete your account" description="Permanently deletes your account and everything in it: your library and highlights, murals, gallery images, tier lists, tournaments, follows and connected accounts. Share links stop working. This can’t be undone.">
      {!open && <button type="button" disabled={account.isPending} onClick={() => setOpen(true)} className={BUTTON_DANGER_OUTLINE}>Delete account…</button>}
    </SettingRow>
    {open && <form onSubmit={submit} className="px-4 py-3"><fieldset disabled={busy} className="space-y-3 text-sm">
      {hasPassword
        ? <label className="block">Enter your password to confirm<PasswordInput required autoComplete="current-password" value={value} onChange={(event) => setValue(event.target.value)} /></label>
        : <label className="block">Type <b>{name}</b> to confirm<input required autoComplete="off" autoCapitalize="none" spellCheck={false} className={`${FIELD_CLASS} mt-1 w-full`} value={value} onChange={(event) => setValue(event.target.value)} /></label>}
      {error && <p role="alert" className="text-(--color-danger)">{error}</p>}
      <div className="flex flex-wrap gap-4"><button className={BUTTON_DANGER}>{busy ? "Deleting…" : "Delete my account"}</button><button type="button" className={BUTTON_SECONDARY} onClick={() => { setOpen(false); setValue(""); setError(""); }}>Cancel</button></div>
    </fieldset></form>}
  </div></SettingGroup>;
}
