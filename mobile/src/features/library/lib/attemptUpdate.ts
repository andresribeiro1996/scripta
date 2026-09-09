export async function attemptUpdate(update: () => Promise<unknown>, onError: () => void, onSuccess?: () => void): Promise<boolean> {
  try {
    await update();
  } catch {
    onError();
    return false;
  }
  onSuccess?.();
  return true;
}
