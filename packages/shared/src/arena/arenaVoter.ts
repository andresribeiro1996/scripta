export function createVoterToken(randomUUID?: () => string): string {
  return randomUUID ? randomUUID() : `anon-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
