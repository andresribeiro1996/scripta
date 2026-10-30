import { AccountSecuritySection } from "../auth/AccountSecuritySection";
import { DeleteAccountSection } from "../auth/DeleteAccountSection";
import { useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { Avatar } from "../components/Avatar";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "../components/page/buttonClasses";
import { Page, SettingGroup, SettingRow } from "../components/page/Page";
import { LIST_PANEL } from "../components/page/surfaceClasses";
import { SocialsSection } from "../components/SocialsSection";
import { area } from "../lib/areas";

export function SettingsPage() {
  const { session, setUsername, uploadAvatar, removeAvatar } = useAuth();
  const [draft, setDraft] = useState(session?.user.username ?? "");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setAvatarError(null);
    setAvatarBusy(true);
    try {
      await uploadAvatar(file);
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleAvatarRemove() {
    setAvatarError(null);
    setAvatarBusy(true);
    try {
      await removeAvatar();
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      await setUsername(draft);
      setEditing(false);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Page title="Settings" tabs={area("settings").tabs} sideTabs>
      <div className="space-y-8">
        <SettingGroup title="Profile">
          <div className={LIST_PANEL}>
            {session && (
              <SettingRow
                leading={<Avatar user={session.user} size={48} className={avatarBusy ? "animate-pulse" : ""} />}
                label="Profile picture"
                description={
                  <>
                    <span className="block">{avatarBusy ? "Working…" : "Shown on your profile, murals and games"}</span>
                    {avatarError ? <span role="alert" className="block text-(--color-danger)">{avatarError}</span> : null}
                  </>
                }
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic"
                  onChange={handleAvatarChange}
                  className="hidden"
                />
                <button disabled={avatarBusy} onClick={() => fileInputRef.current?.click()} className={BUTTON_SECONDARY}>
                  Change picture
                </button>
                {session.user.avatarId && (
                  <button disabled={avatarBusy} onClick={() => void handleAvatarRemove()} className={BUTTON_SECONDARY}>
                    Remove picture
                  </button>
                )}
              </SettingRow>
            )}
            <SettingRow
              label={<label htmlFor="settings-username">Username</label>}
              description={
                <>
                  <span className="block">@{session?.user.username ?? "—"}</span>
                  {error ? <span role="alert" className="block text-(--color-danger)">{error}</span> : null}
                  {success ? <span role="status" className="block text-(--color-accent)">Username updated.</span> : null}
                </>
              }
            >
              {!editing ? (
                <button
                  onClick={() => {
                    setEditing(true);
                    setDraft(session?.user.username ?? "");
                    setError(null);
                    setSuccess(false);
                  }}
                  className={BUTTON_SECONDARY}
                >
                  Change username
                </button>
              ) : (
                <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
                  <input
                    id="settings-username"
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    minLength={3}
                    maxLength={30}
                    pattern="[a-zA-Z0-9_.]+"
                    title="Letters, numbers, underscores, and periods only."
                    className="min-h-11 w-full min-w-0 rounded-lg border border-(--color-border) bg-(--color-surface) px-3 text-sm sm:w-48"
                  />
                  <button type="submit" disabled={submitting} className={BUTTON_PRIMARY}>
                    Save
                  </button>
                  <button type="button" onClick={() => setEditing(false)} className={BUTTON_SECONDARY}>
                    Cancel
                  </button>
                </form>
              )}
            </SettingRow>
          </div>
        </SettingGroup>

        <AccountSecuritySection />
        <SocialsSection />
        <DeleteAccountSection />
      </div>
    </Page>
  );
}
