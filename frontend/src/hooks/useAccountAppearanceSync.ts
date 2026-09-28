import { useEffect } from "react";
import { reconcileAppearance } from "@scripta/shared/themes";
import { fetchAccountAppearance, isAppearanceSyncFailure, saveAccountAppearance } from "../api/appearance";
import { applyAppearance, followAppearanceFromOtherTabs, readAppearance } from "../lib/theme";

async function syncOnce(): Promise<void> {
  const { apply, upload } = reconcileAppearance(await fetchAccountAppearance(), readAppearance());
  applyAppearance(apply);
  if (Object.keys(upload).length > 0) await saveAccountAppearance(upload);
}

export function useAccountAppearanceSync(): void {
  useEffect(() => {
    function run() {
      syncOnce().catch((err: unknown) => {
        if (!isAppearanceSyncFailure(err)) throw err;
      });
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") run();
    }
    run();
    document.addEventListener("visibilitychange", onVisibilityChange);
    const stopFollowing = followAppearanceFromOtherTabs();
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopFollowing();
    };
  }, []);
}
