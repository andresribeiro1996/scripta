import { useEffect } from "react";
import { reconcileThemePreference } from "@scripta/shared/themes";
import { fetchAccountTheme, isThemeSyncFailure, saveAccountTheme } from "../api/theme";
import { applyThemePreference, followThemePreferenceFromOtherTabs, readThemePreference } from "../lib/theme";

async function syncOnce(): Promise<void> {
  const { apply, upload } = reconcileThemePreference(await fetchAccountTheme(), readThemePreference());
  if (apply) applyThemePreference(apply);
  if (upload) await saveAccountTheme(upload);
}

export function useAccountThemeSync(): void {
  useEffect(() => {
    function run() {
      syncOnce().catch((err: unknown) => {
        if (!isThemeSyncFailure(err)) throw err;
      });
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") run();
    }
    run();
    document.addEventListener("visibilitychange", onVisibilityChange);
    const stopFollowing = followThemePreferenceFromOtherTabs();
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopFollowing();
    };
  }, []);
}
