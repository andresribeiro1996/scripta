function parseHex(hex: string): [number, number, number] | null {
  if (typeof hex !== "string" || !/^#[0-9a-fA-F]{6}$/.test(hex)) {
    return null;
  }

  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  return [r, g, b];
}

export function blendHex(
  base: string,
  over: string,
  alpha: number
): string {
  const baseRgb = parseHex(base);
  const overRgb = parseHex(over);

  if (!baseRgb || !overRgb) {
    throw new Error("Invalid hex color");
  }

  const [baseR, baseG, baseB] = baseRgb;
  const [overR, overG, overB] = overRgb;

  const r = Math.round(baseR + (overR - baseR) * alpha);
  const g = Math.round(baseG + (overG - baseG) * alpha);
  const b = Math.round(baseB + (overB - baseB) * alpha);

  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function coverWash(
  color: string | null,
  scheme: "light" | "dark"
): { top: string; mid: string; topAlpha: number } | null {
  if (!color) {
    return null;
  }

  const rgb = parseHex(color);
  if (!rgb) {
    return null;
  }

  const [r, g, b] = rgb;
  const topAlpha = scheme === "light" ? 0.32 : 0.24;
  const midAlpha = topAlpha / 2;

  return {
    top: `rgba(${r}, ${g}, ${b}, ${topAlpha})`,
    mid: `rgba(${r}, ${g}, ${b}, ${midAlpha})`,
    topAlpha,
  };
}
