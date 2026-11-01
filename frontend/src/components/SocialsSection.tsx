import { useEffect, useRef, useState } from "react";
import { ApiError, startSocialConnect, type SocialProvider, type SocialStatus } from "../api/socials";
import { useSocials } from "../hooks/useSocials";
import { useT } from "../i18n";
import { useConfirm } from "./ConfirmDialog";
import { ToggleSwitch } from "./ToggleSwitch";
import { SocialIcon } from "./icons/SocialIcons";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_CLASS } from "./page/buttonClasses";
import { SettingGroup, SettingRow } from "./page/Page";
import { LIST_PANEL } from "./page/surfaceClasses";
import { Sheet } from "./Sheet";

const PROVIDER_META = {
  x: { label: "X", hint: "community.hintPostAndRead" },
  instagram: { label: "Instagram", hint: "community.hintPostAndRead" },
  threads: { label: "Threads", hint: "community.hintPostAndRead" },
  tiktok: { label: "TikTok", hint: "community.hintPostAndRead" },
  bluesky: { label: "Bluesky", hint: "community.hintBluesky" }
} as const satisfies Record<SocialProvider, { label: string; hint: string }>;

/** Settings → Socials — one row per platform, identified by its icon
 *  (SocialIcon, see icons/SocialIcons.tsx) rather than a text label, each
 *  with a real switch-styled toggle (ToggleSwitch, below) rather than a
 *  plain checkbox input. Flipping one ON either kicks off that platform's
 *  OAuth connect flow (see api/socials.ts's startSocialConnect) or, for
 *  Bluesky, opens a small inline form for a handle + app password.
 *  Flipping a connected one OFF asks for confirmation first — enabling it
 *  required handing this app a real key; disabling it throws that key
 *  away, which deserves the same "are you sure" every other destructive
 *  action in this app gets (see ConfirmDialog.tsx). */
export function SocialsSection() {
  const t = useT();
  const { data: socials, isLoading, connectBlueskyAccount, disconnect } = useSocials();
  const confirm = useConfirm();
  const [pendingProvider, setPendingProvider] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blueskyOpen, setBlueskyOpen] = useState(false);

  // The OAuth callback (backend's modules/socials/plugin.ts) lands back
  // here with ?social=<provider>&social_status=connected|error — never
  // tokens, just a result to report, unlike /oauth-success's login flow.
  // Read once, then scrub the URL so a refresh doesn't re-show it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const provider = params.get("social");
    const status = params.get("social_status");
    if (!provider || !status) return;

    if (status === "error") {
      setError(params.get("social_message") ?? t("community.connectFailed", { label: PROVIDER_META[provider as SocialProvider]?.label ?? provider }));
    }
    window.history.replaceState(null, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleEnable(provider: SocialProvider) {
    setError(null);
    if (provider === "bluesky") {
      setBlueskyOpen(true);
      return;
    }
    setPendingProvider(provider);
    try {
      await startSocialConnect(provider);
      // startSocialConnect navigates the browser away on success — this
      // line only runs if it threw before getting that far.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("community.startConnectFailed"));
      setPendingProvider(null);
    }
  }

  async function handleDisable(status: SocialStatus) {
    const meta = PROVIDER_META[status.provider];
    const confirmed = await confirm({
      title: t("community.disconnectTitle", { label: meta.label }),
      body: t("community.disconnectBody", { label: meta.label }),
      confirmLabel: t("community.disconnect")
    });
    if (!confirmed) return;

    setError(null);
    setPendingProvider(status.provider);
    try {
      await disconnect(status.provider);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("community.disconnectFailed"));
    } finally {
      setPendingProvider(null);
    }
  }

  return (
    <>
      <SettingGroup
        title={t("community.socials")}
        description={t("community.socialsDescription")}
      >
        <div className={LIST_PANEL}>
          {isLoading && <p className="px-4 py-3 text-sm text-(--color-text-dim)">{t("library.loadingEllipsis")}</p>}

          {socials?.map((status) => {
            const meta = PROVIDER_META[status.provider];
            const busy = pendingProvider === status.provider;
            return (
              <SettingRow
                key={status.provider}
                leading={
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-(--color-border) bg-(--color-surface) text-(--color-text)">
                    <SocialIcon provider={status.provider} className="h-4.5 w-4.5" />
                  </span>
                }
                label={meta.label}
                description={
                  !status.enabled
                    ? t("community.notSetUp")
                    : status.connected
                      ? status.handle
                        ? t("community.connectedAs", { handle: status.handle })
                        : t("community.connected")
                      : t(meta.hint)
                }
              >
                {busy && <span className="text-xs text-(--color-text-dim)">{t("shell.working")}</span>}
                <span className={status.enabled ? "" : "opacity-50"}>
                  <ToggleSwitch
                    label={t(status.connected ? "community.disconnectProvider" : "community.connectProvider", { label: meta.label })}
                    checked={status.connected}
                    disabled={!status.enabled || busy}
                    onChange={(next) => (next ? void handleEnable(status.provider) : void handleDisable(status))}
                  />
                </span>
              </SettingRow>
            );
          })}

          {error && <p className="px-4 py-3 text-sm text-(--color-danger)">{error}</p>}
        </div>
      </SettingGroup>

      {blueskyOpen && <BlueskyConnectModal onConnect={connectBlueskyAccount} onClose={() => setBlueskyOpen(false)} />}
    </>
  );
}

function BlueskyConnectModal({
  onConnect,
  onClose
}: {
  onConnect: (handle: string, appPassword: string) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const handleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    handleRef.current?.focus();
  }, []);
  const [handle, setHandle] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onConnect(handle.trim(), appPassword);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("community.blueskyFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  const missing =
    handle.trim() === "" && appPassword === ""
      ? t("community.enterHandleAndPassword")
      : handle.trim() === ""
        ? t("community.enterHandle")
        : appPassword === ""
          ? t("community.enterAppPassword")
          : null;

  return (
    <Sheet
      title={t("community.connectBluesky")}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={BUTTON_SECONDARY}>
            {t("shell.cancel")}
          </button>
          <button type="submit" form="bluesky-connect-form" disabled={submitting || missing !== null} className={BUTTON_PRIMARY}>
            {submitting ? t("community.connecting") : t("community.connect")}
          </button>
        </>
      }
    >
      <form id="bluesky-connect-form" onSubmit={(e) => void handleSubmit(e)} className="px-2 pb-2">
        <p className="mb-4 text-xs text-(--color-text-dim)">
          {t("community.blueskyIntro")}
        </p>

        <div className="mb-3">
          <label className="mb-1 block text-sm font-semibold" htmlFor="bluesky-handle">
            {t("community.handle")}
          </label>
          <input
            id="bluesky-handle"
            ref={handleRef}
            required
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="you.bsky.social"
            className={`${FIELD_CLASS} w-full`}
          />
        </div>

        <div className="mb-3">
          <label className="mb-1 block text-sm font-semibold" htmlFor="bluesky-app-password">
            {t("community.appPassword")}
          </label>
          <input
            id="bluesky-app-password"
            type="password"
            required
            value={appPassword}
            onChange={(e) => setAppPassword(e.target.value)}
            placeholder="xxxx-xxxx-xxxx-xxxx"
            className={`${FIELD_CLASS} w-full`}
          />
        </div>

        {missing && <p className="text-xs text-(--color-text-dim)">{missing}</p>}
        {error && <p className="text-xs text-(--color-danger)">{error}</p>}
      </form>
    </Sheet>
  );
}
