export const stackPrefix = (segments: readonly string[]) => (segments[0] === "(app)" ? "" : "/(public)");

export function workPath(id: string, segments: readonly string[], editionId?: string | null): string {
  return `${stackPrefix(segments)}/work/${id}${editionId ? `?edition=${encodeURIComponent(editionId)}` : ""}`;
}

export function bookToolPath(key: string, tool: "style" | "cover" | "finished", segments: readonly string[]): string {
  return `${stackPrefix(segments)}/book/${encodeURIComponent(key)}/${tool}`;
}

export function workStatsPath(id: string, segments: readonly string[]): string {
  return `${workPath(id, segments)}/stats`;
}

export type SeriesSearchMethod = "dismissTo" | "navigate";

export function seriesSearchMethod(segments: readonly string[]): SeriesSearchMethod | null {
  if (segments[0] !== "(app)") return null;
  return segments[1] === "(search)" ? "dismissTo" : "navigate";
}

export function seriesSearchHref(name: string, nonce: number, method: SeriesSearchMethod) {
  const params = { q: name, t: String(nonce) };
  return { pathname: "/search", params: method === "navigate" ? { ...params, pop: "true" } : params };
}

export function workCharactersPath(id: string, segments: readonly string[]): string {
  return `${workPath(id, segments)}/characters`;
}
