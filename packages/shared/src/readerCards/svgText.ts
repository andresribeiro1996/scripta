import { MONO, SANS, SERIF } from "./compose.js";

export const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type TextFont = "serif" | "sans" | "mono";
export interface TextOptions { size: number; font?: TextFont; anchor?: "start" | "middle" | "end"; spacing?: number; weight?: number; italic?: boolean; opacity?: number; cls?: "pt" | "pg" }

const FAMILIES: Record<TextFont, string> = { serif: SERIF, sans: SANS, mono: MONO };
const n2 = (value: number) => +value.toFixed(2);

export function svgText(x: number, y: number, content: string, { size, font = "sans", anchor = "middle", spacing, weight, italic, opacity, cls = "pt" }: TextOptions): string {
  return `<text class="${cls}" x="${n2(x)}" y="${n2(y)}" text-anchor="${anchor}" font-size="${n2(size)}"${spacing ? ` letter-spacing="${spacing}"` : ""} font-family="${FAMILIES[font]}"${weight ? ` font-weight="${weight}"` : ""}${italic ? ` font-style="italic"` : ""}${opacity !== undefined ? ` opacity="${opacity}"` : ""}>${escapeText(content)}</text>`;
}

export function rule(y: number, width = 0.5, extra = ""): string {
  return `<path class="pl" d="M30 ${n2(y)}H220" stroke-width="${width}"${extra}/>`;
}
