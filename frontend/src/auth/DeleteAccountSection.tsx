import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AccountSecurity } from "@scripta/shared";
import { apiFetch } from "../api/client";
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

  return <section className="mt-5 space-y-3 rounded-xl border border-(--color-border) bg-(--color-surface) p-5">
    <h3 className="text-sm font-semibold">Delete account</h3>
    <p className="text-sm text-(--color-text-dim)">Permanently deletes your account and everything in it: your library and highlights, murals, gallery images, tier lists, tournaments, follows and connected accounts. Share links stop working. This can’t be undone.</p>
    {!open ? <button type="button" disabled={account.isPending} onClick={() => setOpen(true)} className="min-h-11 rounded-lg border border-(--color-danger) px-4 text-sm font-semibold text-(--color-danger) disabled:opacity-55">Delete account…</button>
      : <form onSubmit={submit}><fieldset disabled={busy} className="space-y-3 text-sm">
        {hasPassword
          ? <label className="block">Enter your password to confirm<PasswordInput required autoComplete="current-password" value={value} onChange={(event) => setValue(event.target.value)} /></label>
          : <label className="block">Type <b>{name}</b> to confirm<input required autoComplete="off" autoCapitalize="none" spellCheck={false} className="mt-1 w-full rounded-lg border border-(--color-border) bg-(--color-bg) p-3" value={value} onChange={(event) => setValue(event.target.value)} /></label>}
        {error && <p role="alert" className="text-(--color-danger)">{error}</p>}
        <div className="flex flex-wrap gap-4"><button className="min-h-11 rounded-lg bg-(--color-danger) px-4 font-semibold text-(--color-on-danger)">{busy ? "Deleting…" : "Delete my account"}</button><button type="button" onClick={() => { setOpen(false); setValue(""); setError(""); }}>Cancel</button></div>
      </fieldset></form>}
  </section>;
}
