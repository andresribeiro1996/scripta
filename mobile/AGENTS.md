# Mobile

Expo/React Native app. Read `README.md` before changing it.

## Commands

- Start locally from the repository root: `EXPO_PUBLIC_API_URL=http://<LAN-IP>:3000 npm run mobile`
- Verify: `npm run build --workspace @scripta/shared`
- Verify: `npm run typecheck --workspace mobile`
- Verify: `npm test --workspace mobile`
- Verify Expo configuration: `cd mobile && npx expo-doctor`
- Run Maestro only when a device or emulator and test credentials are available.

## Rules

- Put logic shared with the web client in `@scripta/shared`; do not duplicate it.
- Install Expo packages with `npx expo install` to preserve SDK compatibility.
- Normal development and CI must not run `eas build`, `eas submit`, `eas update`, or create APK/AAB artifacts.
- Use Expo Go or an already-installed development client during normal development.
- Rebuild the development client only when native dependencies or native configuration change and the user explicitly requests it.
- Never run `expo prebuild --clean` unless explicitly requested.
- Production builds and submissions require an explicit release request, a clean release ref, and passing checks.
