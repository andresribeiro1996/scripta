// Domain errors for the socials module — mirrors modules/auth/domain/errors.ts's shape.

import type { Vars } from "@scripta/shared/i18n";
import { LocalizedError, type BackendKey } from "../../../i18n/index.js";

export class SocialsNotConfiguredError extends LocalizedError {
  constructor(key: BackendKey = "socials.notConfigured", vars?: Vars) {
    super(key, vars);
    this.name = "SocialsNotConfiguredError";
  }
}

export class SocialProviderNotConfiguredError extends Error {
  constructor(provider: string) {
    super(`${provider} is not configured on this server — no client id/secret/callback URL set for it.`);
    this.name = "SocialProviderNotConfiguredError";
  }
}

export class BlueskyAuthError extends LocalizedError {
  constructor(key: BackendKey, vars?: Vars) {
    super(key, vars);
    this.name = "BlueskyAuthError";
  }
}

/** Thrown by postToSocial when the caller has no stored connection for
 *  that provider yet — the client's fix is to connect it in Settings, so
 *  routes.ts maps this to 409, not 500. */
export class SocialNotConnectedError extends LocalizedError {
  constructor(provider: string) {
    super("socials.notConnected", { provider });
    this.name = "SocialNotConnectedError";
  }
}

/** Thrown by postToSocial when the remote platform itself rejected the
 *  post (bad/expired token, malformed request, platform-side error) —
 *  the remote platform failed, not this server, so routes.ts maps this
 *  to 502, not 500. */
export class SocialPostRejectedError extends LocalizedError {
  constructor(provider: string, detail?: string) {
    if (detail) super("socials.postRejectedDetail", { provider, detail });
    else super("socials.postRejected", { provider });
    this.name = "SocialPostRejectedError";
  }
}
