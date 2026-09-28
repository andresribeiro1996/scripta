import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { parseThemePreference, reconcileThemePreference, type ThemePreference } from "@scripta/shared/themes";
import { ApiError, apiClient } from "../../core/api";
import { useTheme } from "../../ui/theme";

export async function fetchAccountTheme(): Promise<ThemePreference | null> {
  const body = await apiClient.request<{ theme: unknown }>("/auth/theme", { auth: true });
  return body.theme === null ? null : parseThemePreference(body.theme);
}

export async function saveAccountTheme(theme: ThemePreference): Promise<void> {
  await apiClient.request("/auth/theme", { method: "PUT", body: { theme }, auth: true });
}

export function isThemeSyncFailure(err: unknown): boolean {
  return err instanceof ApiError || err instanceof TypeError;
}

export function useAccountThemeSync(): void {
  const { preference, setPreference } = useTheme();
  const latest = useRef(preference);

  useEffect(() => {
    latest.current = preference;
  }, [preference]);

  useEffect(() => {
    async function syncOnce() {
      const { apply, upload } = reconcileThemePreference(await fetchAccountTheme(), latest.current);
      if (apply) setPreference(apply);
      if (upload) await saveAccountTheme(upload);
    }
    function run() {
      syncOnce().catch((err: unknown) => {
        if (!isThemeSyncFailure(err)) throw err;
      });
    }
    run();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") run();
    });
    return () => subscription.remove();
  }, [setPreference]);
}
