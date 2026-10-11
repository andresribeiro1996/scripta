const prefix = (segments: readonly string[]) => (segments[0] === "(app)" ? "" : "/(public)");

export function workPath(id: string, segments: readonly string[]): string {
  return `${prefix(segments)}/work/${id}`;
}

export function bookToolPath(key: string, tool: "style" | "cover" | "finished", segments: readonly string[]): string {
  return `${prefix(segments)}/book/${encodeURIComponent(key)}/${tool}`;
}

export function workStatsPath(id: string, segments: readonly string[]): string {
  return `${workPath(id, segments)}/stats`;
}
