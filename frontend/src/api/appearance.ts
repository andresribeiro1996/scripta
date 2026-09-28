import { parseAccountAppearance, type AccountAppearance, type Appearance } from "@scripta/shared/themes";
import { ApiError, apiFetch } from "./client";

export async function fetchAccountAppearance(): Promise<AccountAppearance> {
  return parseAccountAppearance(await apiFetch("/auth/appearance"));
}

export async function saveAccountAppearance(patch: Partial<Appearance>): Promise<void> {
  await apiFetch("/auth/appearance", { method: "PUT", body: JSON.stringify(patch) });
}

export function isAppearanceSyncFailure(err: unknown): boolean {
  return err instanceof ApiError || err instanceof TypeError;
}
