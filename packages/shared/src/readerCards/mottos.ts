import { EX_LIBRIS, SANS, SERIF, type PlateSlots } from "./compose.js";
import { fitLine, fitSize, textWidth, type FitFont } from "./fit.js";
import type { CardMotto, MottoLook } from "./style.js";
import { escapeText, svgText } from "./svgText.js";

export const LIFTED_EX_LIBRIS = `<text class="pt" x="125" y="31" text-anchor="middle" font-size="6" letter-spacing="3.4" font-family="${SANS}" font-weight="600">EX LIBRIS</text>`;

const MIN_SIZE = 5;
const ARC_PATH = "M56.1 97.4A78 78 0 0 1 193.9 97.4";
const ARC_LENGTH = 168.8;
const WAVE_PATH = "M72 53C87 47 102 59 125 53S163 47 178 53";
const WAVE_LENGTH = 110;

const n2 = (value: number) => +value.toFixed(2);

function fitted(text: string, font: FitFont, size: number, width: number, spacing = 0): { text: string; size: number } {
  const shrunk = fitSize(text, { font, size, width, spacing, min: MIN_SIZE });
  return { text: fitLine(text, { font, size: shrunk, width, spacing }), size: shrunk };
}

function italic(text: string, y: number, size: number, width: number, cls: "pt" | "pg" = "pt", spacing = 0.6): string {
  const line = fitted(text, "serif", size, width, spacing);
  return svgText(125, y, line.text, { size: line.size, font: "serif", italic: true, spacing, cls });
}

function onPath(text: string, id: string, d: string, length: number, size: number, spacing: number): string {
  const line = fitted(text, "serif", size, length - 12, spacing);
  const offset = n2((length - textWidth(line.text, { font: "serif", size: line.size, spacing })) / 2);
  return `<defs><path id="${id}" d="${d}"/></defs><text class="pt" font-size="${line.size}" font-style="italic" font-family="${SERIF}" letter-spacing="${spacing}"><textPath href="#${id}" startOffset="${offset}">${escapeText(line.text)}</textPath></text>`;
}

type Draw = (text: string, id: string) => Pick<PlateSlots, "header" | "banner">;

const LOOKS: Record<MottoLook, Draw> = {
  ribbon: (text) => ({ header: LIFTED_EX_LIBRIS + `<path class="pf" d="M62 41H72V57H62L66 49ZM188 41H178V57H188L184 49Z" opacity=".85"/><path class="pgl" d="M70 38H180V54H70Z" stroke-width="1"/><path class="pf" d="M70 54L74 58V54M180 54L176 58V54"/>` + italic(text, 49.5, 8, 100) }),
  scroll: (text) => ({ header: LIFTED_EX_LIBRIS + `<path class="pgl" d="M74 39H176V55H74Z" stroke-width=".9"/>` + [72, 178].map((x) => `<ellipse class="pgl" cx="${x}" cy="47" rx="4" ry="9" stroke-width=".9"/><ellipse class="pl" cx="${x}" cy="47" rx="1.6" ry="4.5" stroke-width=".6"/>`).join("") + italic(text, 50.5, 8, 94) }),
  arc: (text, id) => ({ header: LIFTED_EX_LIBRIS + onPath(text, id, ARC_PATH, ARC_LENGTH, 8.5, 1) }),
  cartouche: (text) => ({ header: LIFTED_EX_LIBRIS + `<rect class="pgl" x="76" y="37" width="98" height="21" rx="10.5" stroke-width="1"/><rect class="pl" x="79" y="40" width="92" height="15" rx="7.5" stroke-width=".45"/><circle class="pf" cx="73" cy="47.5" r="1.4"/><circle class="pf" cx="177" cy="47.5" r="1.4"/>` + italic(text, 50.5, 7.6, 86) }),
  rule: (text) => ({ header: LIFTED_EX_LIBRIS + `<path class="pl" d="M58 47.5H84M166 47.5H192" stroke-width=".7"/><path class="pf" d="M58 45.3L60.2 47.5L58 49.7L55.8 47.5ZM192 45.3L194.2 47.5L192 49.7L189.8 47.5Z"/>` + italic(text, 50.5, 8.4, 78) }),
  bannerBelow: (text) => ({ banner: `<path class="pf" d="M70 200H82V214H70L74 207ZM180 200H168V214H180L176 207Z" opacity=".85"/><path class="pgl" d="M80 197.5H170V210.5H80Z" stroke-width="1"/>` + italic(text, 206.6, 7.2, 84) }),
  wavyRibbon: (text, id) => ({ header: LIFTED_EX_LIBRIS + `<path class="pf" d="M62 46L70 44V57L62 59L66 52ZM188 46L180 44V57L188 59L184 52Z" opacity=".85"/><path class="pgl" d="M70 44C85 38 100 50 125 44S165 38 180 44V57C165 51 150 63 125 57S85 51 70 57Z" stroke-width=".9"/>` + onPath(text, id, WAVE_PATH, WAVE_LENGTH, 7.6, 0.5) }),
  titleRules: (text) => {
    const line = fitted(text.toUpperCase(), "caps", 6.8, 150, 2.4);
    return { header: LIFTED_EX_LIBRIS + `<path class="pl" d="M48 36.5H202M48 38.6H202M48 55.4H202M48 57.5H202" stroke-width=".55"/>` + svgText(125, 49.6, line.text, { size: line.size, spacing: 2.4, weight: 600 }) };
  },
  dropCap: (text) => {
    const [first = "", ...rest] = [...text];
    const tail = fitted(rest.join(""), "serif", 8.6, 112);
    return { header: LIFTED_EX_LIBRIS + `<rect class="pl" x="72" y="36" width="18" height="20" stroke-width=".9"/><rect class="pl" x="74" y="38" width="14" height="16" stroke-width=".4"/>` + svgText(81, 51.5, first.toUpperCase(), { size: 15, font: "serif" }) + (tail.text ? svgText(94, 50.5, tail.text, { size: tail.size, font: "serif", italic: true, anchor: "start" }) : "") };
  },
  sash: (text) => {
    const line = fitted(text, "serif", 6.8, 80);
    return { header: EX_LIBRIS + `<path class="pf" d="M156.1 16L175.9 16L234 74.1L234 93.9Z"/><path class="pgs" d="M159.21 16L234 90.79M172.79 16L234 77.21" stroke-width=".4"/><g transform="rotate(45 200 50)">${svgText(200, 52.6, line.text, { size: line.size, font: "serif", italic: true, cls: "pg" })}</g>` };
  },
  script: (text) => {
    const line = fitted(text, "script", 12.5, 116);
    return { header: LIFTED_EX_LIBRIS + svgText(125, 51, line.text, { size: line.size, font: "script" }) + `<path class="pl" d="M72 56.5Q125 62.5 178 55" stroke-width=".7" stroke-linecap="round"/>` };
  },
  plaque: (text) => ({ header: LIFTED_EX_LIBRIS + `<path class="pf" d="M71 37H179L182 40V52L179 55H71L68 52V40Z"/><path class="pgs" d="M72.5 39H177.5L180 41.5V50.5L177.5 53H72.5L70 50.5V41.5Z" stroke-width=".4"/>` + italic(text, 49.3, 8, 100, "pg", 0.5) }),
};

export function mottoSlots(motto: CardMotto | null, id: string): Pick<PlateSlots, "header" | "banner"> {
  return motto ? LOOKS[motto.look](motto.text, id) : {};
}
