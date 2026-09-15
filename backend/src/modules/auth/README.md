# Auth deployment

Set `GOOGLE_CALLBACK_URL` to the browser-facing HTTPS callback URL in deployments, including when TLS terminates at a reverse proxy. Google OAuth then uses Secure, host-only `__Host-` state cookies. Plain-HTTP callback URLs retain unprefixed cookies only so local and LAN development continue to work.

## Password recovery and email verification

Set `RESEND_API_KEY`, `AUTH_EMAIL_FROM` (a sender on a verified Resend domain), and an HTTPS `FRONTEND_URL`. The integration uses Resend's HTTP API without an SDK. Without email configuration, password login and password changes still work; recovery returns 503 and Settings explains that email is unavailable. No credentials or reset links are logged.

- `POST /auth/forgot-password` accepts `{email}` and returns the same 202 message for known and unknown accounts. Delivery errors are logged without identifying the account. Resend failures can be retried after the one-minute cooldown. Google-only accounts receive Google sign-in guidance.
- `POST /auth/reset-password` accepts `{token, password}`. Reset links expire after 30 minutes and are consumed atomically. A successful reset invalidates every refresh token (including rotation grace) and increments the account's access-token version.
- `POST /auth/change-password` requires authentication and `{currentPassword, password}`. All sessions are revoked after success.
- `GET /auth/account` returns the current email, verification and password status, whether correction is available, and email-delivery availability.
- `POST /auth/verification-email` sends a verification link. Optional `{email, currentPassword}` starts correction for password accounts without a Google link. The current email stays active until the new mailbox is confirmed. Verification links expire after 24 hours.
- `POST /auth/verify-email` accepts `{token}`. A confirmed email change also revokes all sessions.

Tokens are stored only as hashes. Links carry tokens in URL fragments, which the web page removes before submission. Reset and verification tokens are separate purposes. Both email request types enforce a persistent one-minute per-account cooldown, in addition to route IP limits.

Migration: existing accounts retain access and existing version-zero sessions remain valid. Existing emails start unverified; there is no new login gate or bulk email send. New password signups receive a verification email when delivery is configured. Google sign-in now requires Google's `verified_email` claim and marks the matching account email verified. Settings provides resend and correction for existing accounts.

Password-reset and password-change notification delivery failures are logged; the completed credential change is not rolled back. Recovery/verification email requests are not a durable job queue: an interrupted server can lose an in-flight delivery, and the user can request another link.
