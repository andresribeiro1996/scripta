export type FitFont = "serif" | "sans" | "caps" | "mono" | "script" | "italic";
export interface FitOptions { font: FitFont; size: number; width: number; spacing?: number }

const EM: Record<FitFont, number> = { serif: 0.5, sans: 0.55, caps: 0.68, mono: 0.6, script: 0.42, italic: 0.44 };

const WIDE_EM = 0.95;
const isWide = (char: string) => /[WMwm]/.test(char) || char.codePointAt(0)! >= 0x2e80;
const emOf = (font: FitFont, char: string) => (font !== "mono" && isWide(char) ? WIDE_EM : EM[font]);
const emSum = (chars: string[], font: FitFont) => chars.reduce((sum, char) => sum + emOf(font, char), 0);

export function textWidth(text: string, { font, size, spacing = 0 }: Omit<FitOptions, "width">): number {
  const chars = [...text];
  return emSum(chars, font) * size + Math.max(0, chars.length - 1) * spacing;
}

export function fitSize(text: string, { font, size, width, spacing = 0, min }: FitOptions & { min: number }): number {
  if (textWidth(text, { font, size, spacing }) <= width) return size;
  const chars = [...text];
  const room = width - Math.max(0, chars.length - 1) * spacing;
  return Math.max(min, Math.floor((room / emSum(chars, font)) * 100) / 100);
}

export function fitLine(text: string, options: FitOptions): string {
  if (textWidth(text, options) <= options.width) return text;
  const chars = [...text];
  const spacing = options.spacing ?? 0;
  let used = emOf(options.font, "…") * options.size;
  let keep = 0;
  while (keep < chars.length) {
    used += emOf(options.font, chars[keep]!) * options.size + spacing;
    if (used > options.width) break;
    keep += 1;
  }
  return `${chars.slice(0, keep).join("").trimEnd()}…`;
}

export function wrapLines(text: string, { lines, ...options }: FitOptions & { lines: number }): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let i = 0;
  while (i < words.length && out.length < lines - 1) {
    let line = words[i]!;
    i += 1;
    while (i < words.length && textWidth(`${line} ${words[i]}`, options) <= options.width) {
      line = `${line} ${words[i]}`;
      i += 1;
    }
    out.push(fitLine(line, options));
  }
  if (i < words.length) out.push(fitLine(words.slice(i).join(" "), options));
  return out;
}
