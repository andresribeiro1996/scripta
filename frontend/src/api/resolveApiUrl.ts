export function resolveApiUrl(
  env: { apiUrl?: string; apiPort?: string },
  location: { protocol: string; hostname: string },
): string {
  if (env.apiUrl) return env.apiUrl;
  const port = Number(env.apiPort) || 3000;
  return `${location.protocol}//${location.hostname}:${port}`;
}
