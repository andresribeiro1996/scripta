import type { LibrarySubmitResult } from "@scripta/shared";

export function assertSaved(result: LibrarySubmitResult): void {
  if (!result.ok) throw result.error;
}

export async function attemptUpdate(update: () => Promise<unknown>, onError: (error: unknown) => void, onSuccess?: () => void): Promise<boolean> {
  try {
    await update();
  } catch (error) {
    onError(error);
    return false;
  }
  onSuccess?.();
  return true;
}
