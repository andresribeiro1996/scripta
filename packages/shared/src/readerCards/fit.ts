export type FitFont = "serif" | "sans" | "caps" | "mono";
export interface FitOptions { font: FitFont; size: number; width: number; spacing?: number }

const EM: Record<FitFont, number> = { serif: 0.5, sans: 0.55, caps: 0.68, mono: 0.6 };

export function textWidth(text: string, { font, size, spacing = 0 }: Omit<FitOptions, "width">): number {
  const count = [...text].length;
  return count * EM[font] * size + Math.max(0, count - 1) * spacing;
}

export function fitSize(text: string, { font, size, width, spacing = 0, min }: FitOptions & { min: number }): number {
  if (textWidth(text, { font, size, spacing }) <= width) return size;
  const count = [...text].length;
  const room = width - Math.max(0, count - 1) * spacing;
  return Math.max(min, Math.floor((room / (count * EM[font])) * 100) / 100);
}

export function fitLine(text: string, options: FitOptions): string {
  const chars = [...text];
  const spacing = options.spacing ?? 0;
  const room = Math.floor((options.width + spacing) / (EM[options.font] * options.size + spacing));
  if (chars.length <= room) return text;
  return `${chars.slice(0, Math.max(0, room - 1)).join("").trimEnd()}…`;
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
