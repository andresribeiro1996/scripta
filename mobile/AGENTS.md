# Mobile

Expo/React Native app. Read `README.md` before changing it.

## Commands

- Test on a physical phone from the repository root: `node scripts/dev-phone.mjs` — one command, signed in, no password (see README.md's "Running")
- Start locally by hand: `EXPO_PUBLIC_API_URL=http://<LAN-IP>:3000 npm run mobile`
- Verify: `npm run build --workspace @scripta/shared`
- Verify: `npm run typecheck --workspace mobile`
- Verify: `npm test --workspace mobile`
- Verify Expo configuration: `cd mobile && npx expo-doctor`
- Run Maestro only when a device or emulator and test credentials are available.

## Rules

- Put logic shared with the web client in `@scripta/shared`; do not duplicate it.
- Install Expo packages with `npx expo install` to preserve SDK compatibility.
- Normal development and CI must not run `eas build` or `eas submit`, or create APK/AAB artifacts.
- JavaScript reaches installed builds over the air: `.eas/workflows/production-update.yml` publishes an `eas update` to the `production` channel on pushes to `production` (the Deploy workflow) that touch the app, but only when a production Android build with the same fingerprint exists. Never run `eas update` by hand unless the user asks. When that run fails with "native release needed", tell the user a release is due; don't start a build.
- Use Expo Go or an already-installed development client during normal development.
- Rebuild the development client only when native dependencies or native configuration change and the user explicitly requests it.
- Never run `expo prebuild --clean` unless explicitly requested.
- Production builds and submissions require an explicit release request, a clean release ref, and passing checks.
- An Android store release is one command from `mobile/`: `npx eas-cli workflow:run .eas/workflows/android-release.yml --ref production` builds what is deployed on EAS and uploads it to Play internal testing. Without `--ref` it uploads whatever the local checkout holds. Deploy first, so a new build never calls an API the backend doesn't serve yet. Run it only on an explicit release request — the EAS account is on the Free plan (15 Android builds a month).
- For UI/UX changes, check `../DESIGN.md` (or the live Atmyshelf Design System artifact it mirrors) for existing tokens/components before introducing new colors, spacing, or radii.
