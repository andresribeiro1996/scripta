# External services

Index of third-party services Scripta depends on. Plan and price columns marked `?` are not recorded anywhere in the repo; confirm in each dashboard. Credentials are env var names only.

## Production

| Service | Used for | Where | Plan | Cost risk |
|---|---|---|---|---|
| Railway | Fastify API at api.atmyshelf.com, 5 GB `/data` volume | `.railway/railway.ts`, `backend/scripts/*litestream.sh` | ? | Paid, usage-based. Volume growth (SQLite + uploads) and always-on compute |
| Cloudflare R2 | `atmyshelf-images` (public, images.atmyshelf.com), `atmyshelf-backups` (Litestream, 14 day retention) | `backend/src/storage/`, `backend/litestream.yml` | ? (pay-as-you-go with free allowance) | Free while under the monthly storage and operation allowance; egress is free. Grows with covers, gallery uploads and daily snapshots of 11 DBs |
| Cloudflare Pages | Web PWA at atmyshelf.com, `assetlinks.json` | dashboard only, no wrangler config | ? (presumably free) | Free tier is generous; builds per month are the only limit |
| Cloudflare DNS | atmyshelf.com, api., images. | dashboard | Free | none. Registrar unknown, renewal is a yearly cost |
| Resend | Auth emails, waitlist, ISBNdb alert | `backend/src/modules/auth/email.ts` | ? | Free tier has daily and monthly send caps; signups past that need a paid plan |
| Google OAuth | Sign-in (web and mobile) | `backend/src/modules/auth/plugin.ts` | Free | none. Consent screen verification may be needed as users grow |
| ISBNdb | Edition metadata, covers, search | `backend/src/modules/books/adapters/isbndb/` | Basic (paid) | Already paid, about 1 req/s and 5,000/day. Data must be deleted if the subscription lapses |
| Apple iTunes Search API | Best free cover source | `adapters/sources/apple.ts` | Free, keyless | Rate limited (about 20/min), can be throttled or changed |
| Open Library | Catalog and low-res covers | `adapters/openlibrary/` | Free, keyless | Rate limited, no cost |
| PT publisher sites | Cover scraping | `seed/publishers.ts` | Free | Legal/robots risk, not cost |
| Litestream 0.5.17 | SQLite replication to R2 | `backend/scripts/install-litestream.sh` | OSS | Build depends on GitHub Releases |

## Mobile

| Service | Used for | Plan | Cost risk |
|---|---|---|---|
| Expo EAS | Build, Submit, Workflows, Update (`@am-yngwie/scripta`) | Free | 15 Android + 15 iOS builds a month, 1 concurrent. OTA capped at 1,000 unique devices and 100 GiB. 6 Android builds used by 2026-09-30. Check `npx eas-cli account:usage am-yngwie --json`. Past either cap means the Starter plan (paid) |
| Google Play Console | Internal testing track, `com.atmyshelf.app` | One-time fee (paid) | none recurring |
| Apple Developer | iOS bundle id configured, no submit profile or workflow | ? | Yearly fee when iOS ships |

## CI and source

| Service | Used for | Plan | Cost risk |
|---|---|---|---|
| GitHub Actions | `ci.yml`, manual `cover-trial.yml` (up to 340 min a run) | ? | If the repo is private on Free: 2,000 min/month. One cover-trial run can use about 5.5 h |
| GitHub | Repo, `main-protect` ruleset, Railway and Pages deploy hooks | ? | Rulesets on private repos need a paid plan |
| npm registry | all packages | Free | none |

## Optional / not live

| Service | Used for | Status |
|---|---|---|
| X, Instagram, Threads, TikTok, Bluesky | Social account linking (`backend/src/modules/socials/`) | Env vars blank in `.env.example`; skipped when unset. X API access is paid at most tiers |
| Google Books | Dropped in PR #57 | Not used |

## Not present

No Sentry, analytics, push notifications, crash reporting or Google Fonts.

## Env vars by service

- R2: `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_IMAGES_BUCKET`, `R2_IMAGES_PUBLIC_URL`, `R2_BACKUPS_BUCKET`
- Resend: `RESEND_API_KEY`, `AUTH_EMAIL_FROM`, `ALERT_EMAIL`
- Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `OAUTH_SUCCESS_REDIRECT_URL`, `MOBILE_OAUTH_REDIRECT_ALLOWLIST`
- ISBNdb: `ISBNDB_API_KEY` (also a GitHub Actions secret)
- Socials: `SOCIALS_ENCRYPTION_KEY`, `X_*`, `INSTAGRAM_*`, `THREADS_*`, `TIKTOK_*`
- Web build: `VITE_API_URL`, `VITE_IMAGES_URL`
- Mobile: `EXPO_PUBLIC_API_URL`

## Open questions

- Railway, R2, Pages, Resend and GitHub plans
- Domain registrar and renewal date
- Apple Developer account status
