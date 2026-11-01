import { t } from "../../i18n";

export function snapshotSize(width: number, height: number) {
  if (width <= 0 || height <= 0) throw new Error(t("sharing.imageNotReady"));
  const scale = Math.min(3, 1200 / width, 16000 / height, Math.sqrt(16_000_000 / (width * height)));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function contentUrl(frontendUrl: string, path: string) {
  const base = new URL(frontendUrl);
  if (!["https:", "http:"].includes(base.protocol) || base.username || base.password) throw new Error(t("sharing.websiteAddressInvalid"));
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) throw new Error(t("sharing.sharePathInvalid"));
  return new URL(path, base).href;
}
