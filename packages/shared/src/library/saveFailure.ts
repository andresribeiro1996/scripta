export function saveFailureMessage(error: unknown, generic: string): string {
  return error instanceof Error && "status" in error && error.status === 413 ? error.message : generic;
}
