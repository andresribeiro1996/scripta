import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { parseAccountAppearance, reconcileAppearance, type AccountAppearance, type Appearance } from "@scripta/shared/themes";
import { ApiError, apiClient } from "../../core/api";
import { useTheme } from "../../ui/theme";

export async function fetchAccountAppearance(): Promise<AccountAppearance> {
  return parseAccountAppearance(await apiClient.request<unknown>("/auth/appearance", { auth: true }));
}

export async function saveAccountAppearance(patch: Partial<Appearance>): Promise<void> {
  await apiClient.request("/auth/appearance", { method: "PUT", body: patch, auth: true });
}

export function isAppearanceSyncFailure(err: unknown): boolean {
  return err instanceof ApiError || err instanceof TypeError;
}

export function useAccountAppearanceSync(): void {
  const { preference, displayFont, textFont, setPreference, setFontPreference } = useTheme();
  const latest = useRef<Appearance>({ theme: preference, displayFont, textFont });

  useEffect(() => {
    latest.current = { theme: preference, displayFont, textFont };
  }, [preference, displayFont, textFont]);

  useEffect(() => {
    async function syncOnce() {
      const { apply, upload } = reconcileAppearance(await fetchAccountAppearance(), latest.current);
      if (apply.theme) setPreference(apply.theme);
      if (apply.displayFont) setFontPreference("display", apply.displayFont);
      if (apply.textFont) setFontPreference("text", apply.textFont);
      if (Object.keys(upload).length > 0) await saveAccountAppearance(upload);
    }
    function run() {
      syncOnce().catch((err: unknown) => {
        if (!isAppearanceSyncFailure(err)) throw err;
      });
    }
    run();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") run();
    });
    return () => subscription.remove();
  }, [setPreference, setFontPreference]);
}
