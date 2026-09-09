// Locates the Android SDK + JDK this machine's toolchain actually lives at,
// so scripts/dev-emulator.mjs doesn't have to assume a shell profile has
// ANDROID_HOME/JAVA_HOME exported. Installed via:
//
//   brew install openjdk
//   brew install --cask android-commandlinetools
//   sdkmanager --sdk_root="$ANDROID_HOME" platform-tools emulator \
//     platforms;android-35 "system-images;android-35;google_apis;arm64-v8a"
//   avdmanager create avd -n scripta-dev \
//     -k "system-images;android-35;google_apis;arm64-v8a"
//
// (dev-emulator.mjs runs the sdkmanager/avdmanager steps itself on a
// machine that doesn't have them yet — see its own ensureAvd.)
//
// Neither cask needs sudo: openjdk is keg-only (not symlinked into
// /opt/homebrew, since macOS ships its own java shim) and
// android-commandlinetools installs straight into
// /opt/homebrew/share/android-commandlinetools. This reads both locations
// directly rather than requiring the caveat-suggested
// `sudo ln -s .../openjdk.jdk /Library/Java/...` symlink.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const JAVA_HOME_CANDIDATES = [
  process.env.JAVA_HOME,
  "/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home",
  "/usr/local/opt/openjdk/libexec/openjdk.jdk/Contents/Home", // Intel Homebrew prefix
].filter(Boolean);

const ANDROID_HOME_CANDIDATES = [
  process.env.ANDROID_HOME,
  "/opt/homebrew/share/android-commandlinetools",
  "/usr/local/share/android-commandlinetools",
  join(homedir(), "Library/Android/sdk"),
].filter(Boolean);

function firstExisting(candidates) {
  return candidates.find((path) => existsSync(path));
}

/** Throws with the exact setup commands when the toolchain isn't
 *  installed, rather than failing deep inside a spawned `emulator`/
 *  `adb` with a confusing ENOENT. */
export function androidSdk() {
  const javaHome = firstExisting(JAVA_HOME_CANDIDATES);
  const androidHome = firstExisting(ANDROID_HOME_CANDIDATES);
  if (!javaHome || !androidHome) {
    const missing = [!javaHome && "openjdk", !androidHome && "android-commandlinetools"].filter(Boolean).join(" and ");
    throw new Error(
      `Android toolchain not found (missing ${missing}). One-time setup:\n` +
        "  brew install openjdk\n" +
        "  brew install --cask android-commandlinetools\n" +
        '  export JAVA_HOME=/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home ANDROID_HOME=/opt/homebrew/share/android-commandlinetools PATH="$JAVA_HOME/bin:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$PATH"\n' +
        "  yes | sdkmanager --licenses\n" +
        '  sdkmanager platform-tools emulator platforms\\;android-35 "system-images;android-35;google_apis;arm64-v8a"',
    );
  }
  return { javaHome, androidHome };
}

/** `{...process.env, ...androidEnv()}` gives a spawned child (or an
 *  inline adb/emulator/sdkmanager call from this script itself) working
 *  JAVA_HOME/ANDROID_HOME and every SDK bin directory on PATH. */
export function androidEnv() {
  const { javaHome, androidHome } = androidSdk();
  const bins = [
    join(javaHome, "bin"),
    join(androidHome, "emulator"),
    join(androidHome, "platform-tools"),
    join(androidHome, "cmdline-tools/latest/bin"),
  ];
  return {
    JAVA_HOME: javaHome,
    ANDROID_HOME: androidHome,
    PATH: `${bins.join(":")}:${process.env.PATH ?? ""}`,
  };
}
