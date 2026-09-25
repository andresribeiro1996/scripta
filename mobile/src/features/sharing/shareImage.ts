export function snapshotSize(width: number, height: number) {
  if (width <= 0 || height <= 0) throw new Error("The image preview is not ready yet.");
  const scale = Math.min(3, 1200 / width, 16000 / height, Math.sqrt(16_000_000 / (width * height)));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function contentUrl(frontendUrl: string, path: string) {
  const base = new URL(frontendUrl);
  if (!["https:", "http:"].includes(base.protocol) || base.username || base.password) throw new Error("The public website address is invalid.");
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) throw new Error("The share path is invalid.");
  return new URL(path, base).href;
}
