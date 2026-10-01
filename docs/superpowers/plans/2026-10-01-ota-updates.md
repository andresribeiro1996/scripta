# OTA updates (phase 2 of Android releases)

Branch `claude/scripta-ota-updates-phase-2-d506a2`. Phase 1 (PR #93) made `mobile/.eas/workflows/android-release.yml` a manual build + Play internal submit. This phase ships JavaScript to installed production builds over the air, and never spends a build.

## Design

- `expo-updates` (SDK 57 pin: `~57.0.24`), `runtimeVersion: { policy: "fingerprint" }`, `updates.url: https://u.expo.dev/08320592-07d4-4e5b-b124-f46315c420df` in `mobile/app.json`.
- `eas.json` `build.production.channel: "production"`, so every store build listens to the `production` channel.
- New `mobile/.eas/workflows/production-update.yml`, on push to `main` touching the app:
  1. `fingerprint` job (`environment: production`) → `android_fingerprint_hash`.
  2. `get-build` job: `platform: android`, `profile: production`, `channel: production`, `fingerprint_hash` from step 1.
  3. If a build came back: `update` job, `platform: android`, `channel: production`, `environment: production`, `env.EXPO_PUBLIC_API_URL: https://api.atmyshelf.com`.
  4. If not: a custom job that prints "native release needed: run `npx eas-cli workflow:run .eas/workflows/android-release.yml` from mobile/" with the fingerprint, then exits 1. A red run is the report — it shows on the EAS dashboard and as the commit's status on GitHub.
  - No `build` job anywhere in the file.
  - `concurrency: cancel_in_progress: true` so two quick merges can't land the older update last.
  - `paths`: `mobile/**`, `packages/shared/**`, `package.json`, `package-lock.json`, `patches/**`, `!**/*.md`.

### Why the inline `EXPO_PUBLIC_API_URL`

`eas update` does not read a build profile's `env`. `mobile/src/core/config.ts` throws at startup when the variable is missing, so an update published without it would crash every phone on launch. The value duplicates `eas.json`'s production profile; moving both to an EAS environment variable is a user-side step and not part of this branch.

### What happens on the merge of this branch

Adding `expo-updates` changes the native fingerprint, and version code 9 was built without it. The first run therefore goes red with "native release needed". That is correct: the user runs the Android release once; from then on JS-only merges become updates.

### User-side prerequisites (not code)

- The EAS project must be linked to the GitHub repo with base directory `mobile` (expo.dev → project → GitHub). Without it the push trigger never fires.

## Task 1 — install and configure expo-updates

Files: `mobile/package.json`, `package-lock.json`, `mobile/app.json`, `mobile/eas.json`.

1. Lockfile-only install from `mobile/`: `npm install --package-lock-only -w mobile expo-updates@~57.0.24` (run at repo root; not `expo install --fix`).
2. `rm mobile/node_modules frontend/node_modules && rm -rf node_modules`, then `npm run dev:link-deps` for a real install in the worktree. Confirm `readlink node_modules/@scripta/shared` prints `../../packages/shared`.
3. Add `runtimeVersion` and `updates.url` to `expo` in `app.json`. Do not run `eas update:configure` (it rewrites files and talks to EAS).
4. Add `"channel": "production"` to `build.production` in `eas.json`. Leave `env` as is.
5. Verify: `npm run build --workspace @scripta/shared`, `EXPO_PUBLIC_API_URL=http://localhost:3000 npm run typecheck --workspace mobile`, same for `npm test --workspace mobile`, `cd mobile && npx expo-doctor`, and `cd mobile && npx expo config --type public` shows `runtimeVersion.policy: fingerprint` and the updates url.
6. Commit.

## Task 2 — workflow and rules

Files: `mobile/.eas/workflows/production-update.yml` (new), `mobile/AGENTS.md`.

1. Write the workflow per the design. Validate from `mobile/`: `npx -y eas-cli@latest workflow:validate .eas/workflows/production-update.yml --non-interactive` until it prints `Workflow configuration YAML is valid.` Do not `workflow:run` it.
2. `mobile/AGENTS.md`: replace the rule "Normal development and CI must not run `eas build`, `eas submit`, `eas update`…" with:
   - Normal development and CI must not run `eas build` or `eas submit`, or create APK/AAB artifacts.
   - JavaScript reaches installed builds over the air: `.eas/workflows/production-update.yml` publishes an `eas update` to the `production` channel on pushes to `main` that touch the app, but only when a production Android build with the same fingerprint exists. Never run `eas update` by hand unless the user asks. When that run fails with "native release needed", tell the user a release is due; don't start a build.
3. `npm run check:agents` still passes.
4. Commit.

## Out of scope

iOS updates, rollout percentages, code signing, EAS environment variables, update health checks.
