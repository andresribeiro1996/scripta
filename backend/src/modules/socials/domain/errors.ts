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
