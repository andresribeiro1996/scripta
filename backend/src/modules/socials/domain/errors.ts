// Domain errors for the socials module — mirrors modules/auth/domain/errors.ts's shape.

export class SocialsNotConfiguredError extends Error {
  constructor(message = "Socials storage is not configured on this server (SOCIALS_ENCRYPTION_KEY is unset).") {
    super(message);
    this.name = "SocialsNotConfiguredError";
  }
}

export class SocialProviderNotConfiguredError extends Error {
  constructor(provider: string) {
    super(`${provider} is not configured on this server — no client id/secret/callback URL set for it.`);
    this.name = "SocialProviderNotConfiguredError";
  }
}

export class BlueskyAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlueskyAuthError";
  }
}

/** Thrown by postToSocial when the caller has no stored connection for
 *  that provider yet — the client's fix is to connect it in Settings, so
 *  routes.ts maps this to 409, not 500. */
export class SocialNotConnectedError extends Error {
  constructor(provider: string) {
    super(`${provider} isn't connected — connect it in Settings first.`);
    this.name = "SocialNotConnectedError";
  }
}

/** Thrown by postToSocial when the remote platform itself rejected the
 *  post (bad/expired token, malformed request, platform-side error) —
 *  the remote platform failed, not this server, so routes.ts maps this
 *  to 502, not 500. */
export class SocialPostRejectedError extends Error {
  constructor(provider: string, detail?: string) {
    super(`${provider} rejected this post${detail ? ` (${detail})` : ""} — try reconnecting ${provider} in Settings.`);
    this.name = "SocialPostRejectedError";
  }
}
