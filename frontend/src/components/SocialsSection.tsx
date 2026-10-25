import { useEffect, useRef, useState } from "react";
import { ApiError, startSocialConnect, type SocialProvider, type SocialStatus } from "../api/socials";
import { useSocials } from "../hooks/useSocials";
import { useConfirm } from "./ConfirmDialog";
import { ToggleSwitch } from "./ToggleSwitch";
import { SocialIcon } from "./icons/SocialIcons";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "./page/buttonClasses";
import { Sheet } from "./Sheet";

const PROVIDER_META: Record<SocialProvider, { label: string; hint: string }> = {
  x: { label: "X", hint: "Post and read on your behalf." },
  instagram: { label: "Instagram", hint: "Post and read on your behalf." },
  threads: { label: "Threads", hint: "Post and read on your behalf." },
  tiktok: { label: "TikTok", hint: "Post and read on your behalf." },
  bluesky: {
    label: "Bluesky",
    hint: "Sign in with an app password (Bluesky Settings → App Passwords), not your real password."
  }
};

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
      setError(params.get("social_message") ?? `Couldn't connect ${PROVIDER_META[provider as SocialProvider]?.label ?? provider}.`);
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
      setError(err instanceof ApiError ? err.message : "Couldn't start that connection.");
      setPendingProvider(null);
    }
  }

  async function handleDisable(status: SocialStatus) {
    const meta = PROVIDER_META[status.provider];
    const confirmed = await confirm({
      title: `Disconnect ${meta.label}?`,
      body: `Atmyshelf will delete the ${meta.label} access token it has stored. You'll need to reconnect and re-authorize to use it again.`,
      confirmLabel: "Disconnect"
    });
    if (!confirmed) return;

    setError(null);
    setPendingProvider(status.provider);
    try {
      await disconnect(status.provider);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't disconnect that platform.");
    } finally {
      setPendingProvider(null);
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-(--color-border) bg-(--color-surface) p-5">
      <h3 className="mb-1 text-sm font-semibold">Socials</h3>
      <p className="mb-4 text-xs text-(--color-text-dim)">
        Connect social platforms so Atmyshelf can act on your behalf. Enabling one requires signing in and authorizing access; the key it
        gets is stored only to make that possible.
      </p>

      {isLoading && <p className="text-sm text-(--color-text-dim)">Loading…</p>}

      {socials && (
        <ul className="space-y-3">
          {socials.map((status) => {
            const meta = PROVIDER_META[status.provider];
            const busy = pendingProvider === status.provider;
            return (
              <li key={status.provider} className={`flex items-center gap-3 ${status.enabled ? "" : "opacity-50"}`}>
                <span
                  title={meta.label}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-(--color-border) bg-(--color-surface) text-(--color-text)"
                >
                  <SocialIcon provider={status.provider} className="h-4.5 w-4.5" />
                </span>

                <div className="min-w-0 flex-1">
                  <span className="sr-only">{meta.label}</span>
                  <p className="truncate text-xs text-(--color-text-dim)">
                    {!status.enabled
                      ? "Not set up on this server yet."
                      : status.connected
                        ? `Connected${status.handle ? ` as ${status.handle}` : ""}.`
                        : meta.hint}
                  </p>
                </div>

                {busy && <span className="text-xs text-(--color-text-dim)">Working…</span>}

                <ToggleSwitch
                  label={`${status.connected ? "Disconnect" : "Connect"} ${meta.label}`}
                  checked={status.connected}
                  disabled={!status.enabled || busy}
                  onChange={(next) => (next ? void handleEnable(status.provider) : void handleDisable(status))}
                />
              </li>
            );
          })}
        </ul>
      )}

      {error && <p className="mt-3 text-xs text-(--color-danger)">{error}</p>}

      {blueskyOpen && <BlueskyConnectModal onConnect={connectBlueskyAccount} onClose={() => setBlueskyOpen(false)} />}
    </section>
  );
}

function BlueskyConnectModal({
  onConnect,
  onClose
}: {
  onConnect: (handle: string, appPassword: string) => Promise<void>;
  onClose: () => void;
}) {
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
      setError(err instanceof ApiError ? err.message : "Couldn't connect that Bluesky account.");
    } finally {
      setSubmitting(false);
    }
  }

  const missing =
    handle.trim() === "" && appPassword === ""
      ? "Enter your handle and an app password."
      : handle.trim() === ""
        ? "Enter your handle."
        : appPassword === ""
          ? "Enter an app password."
          : null;

  return (
    <Sheet
      title="Connect Bluesky"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={BUTTON_SECONDARY}>
            Cancel
          </button>
          <button type="submit" form="bluesky-connect-form" disabled={submitting || missing !== null} className={BUTTON_PRIMARY}>
            {submitting ? "Connecting…" : "Connect"}
          </button>
        </>
      }
    >
      <form id="bluesky-connect-form" onSubmit={(e) => void handleSubmit(e)} className="px-2 pb-2">
        <p className="mb-4 text-xs text-(--color-text-dim)">
          Use an app password, not your real one — generate one from Bluesky at Settings → App Passwords. Atmyshelf never sees your actual
          account password.
        </p>

        <div className="mb-3">
          <label className="mb-1 block text-sm font-semibold" htmlFor="bluesky-handle">
            Handle
          </label>
          <input
            id="bluesky-handle"
            ref={handleRef}
            required
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="you.bsky.social"
            className="min-h-11 w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-1.5 text-sm"
          />
        </div>

        <div className="mb-3">
          <label className="mb-1 block text-sm font-semibold" htmlFor="bluesky-app-password">
            App password
          </label>
          <input
            id="bluesky-app-password"
            type="password"
            required
            value={appPassword}
            onChange={(e) => setAppPassword(e.target.value)}
            placeholder="xxxx-xxxx-xxxx-xxxx"
            className="min-h-11 w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-1.5 text-sm"
          />
        </div>

        {missing && <p className="text-xs text-(--color-text-dim)">{missing}</p>}
        {error && <p className="text-xs text-(--color-danger)">{error}</p>}
      </form>
    </Sheet>
  );
}
