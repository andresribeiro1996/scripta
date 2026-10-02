export function saveFailureMessage(error: unknown, generic: string): string {
  if (!(error instanceof Error) || !("status" in error)) return generic;
  if (error.status === 413) return error.message || generic;
  if (error.status === 429) return "Too many changes in a row — wait a minute and try again.";
  return generic;
}
