export function workPath(id: string, segments: readonly string[]): string {
  return segments[0] === "(app)" ? `/work/${id}` : `/(public)/work/${id}`;
}
