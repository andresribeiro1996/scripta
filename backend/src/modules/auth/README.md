# Auth deployment

Set `GOOGLE_CALLBACK_URL` to the browser-facing HTTPS callback URL in deployments, including when TLS terminates at a reverse proxy. Google OAuth then uses Secure, host-only `__Host-` state cookies. Plain-HTTP callback URLs retain unprefixed cookies only so local and LAN development continue to work.
