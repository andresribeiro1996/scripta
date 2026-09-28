import { parseThemePreference, type ThemePreference } from "@scripta/shared/themes";
import { ApiError, apiFetch } from "./client";

export async function fetchAccountTheme(): Promise<ThemePreference | null> {
  const body = (await apiFetch("/auth/theme")) as { theme: unknown };
  return body.theme === null ? null : parseThemePreference(body.theme);
}

export async function saveAccountTheme(theme: ThemePreference): Promise<void> {
  await apiFetch("/auth/theme", { method: "PUT", body: JSON.stringify({ theme }) });
}

export function isThemeSyncFailure(err: unknown): boolean {
  return err instanceof ApiError || err instanceof TypeError;
}
