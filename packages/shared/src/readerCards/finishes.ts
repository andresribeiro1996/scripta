import { FRAME_MARKUP, type InkWrap, type PlateSlots } from "./compose.js";
import { inks, mix, withStyle } from "./paint.js";
import { INKS, type IdentityKey } from "./plates.js";
import type { PlatePrint } from "./render.js";
import { random, seedOf } from "./seed.js";
import type { Finish } from "./style.js";
import { TEXTURES, TEXTURE_SIZE, type Texture } from "./textures.js";

export interface FinishContext { print: PlatePrint; ink: IdentityKey | "graph"; streak: IdentityKey | null; seed: number; front: boolean; seal: { x: number; y: number } | null; corners: string }
export interface FinishLayers { palette: [string, string]; slots: Pick<PlateSlots, "underlay" | "overlay" | "frame" | "corners">; wrapInk?: InkWrap }

interface Paint extends FinishContext { ground: string; line: string; plate: string; deep: string; paper: boolean; id: (name: string) => string }
type Builder = (paint: Paint) => FinishLayers;

const TILE = TEXTURE_SIZE / 2;
const SHEET = `width="250" height="350" rx="4"`;
const f = (value: number) => value.toFixed(2);

function textured(texture: Texture, id: (name: string) => string, colour: string, opacity: number): { defs: string; layer: string } {
  const tile = id(`${texture}Tile`), mask = id(`${texture}Mask`);
  return {
    defs: `<pattern id="${tile}" patternUnits="userSpaceOnUse" width="${TILE}" height="${TILE}"><image href="${TEXTURES[texture]}" width="${TILE}" height="${TILE}" preserveAspectRatio="none"/></pattern><mask id="${mask}" maskUnits="userSpaceOnUse" x="0" y="0" width="250" height="350"><rect width="250" height="350" fill="url(#${tile})"/></mask>`,
    layer: `<rect ${SHEET} fill="${colour}" opacity="${opacity}" mask="url(#${mask})"/>`,
  };
}

function vignette(id: string, colour: string, opacity: number): { defs: string; layer: string } {
  return {
    defs: `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="125" cy="175" r="215"><stop offset=".55" stop-color="${colour}" stop-opacity="0"/><stop offset="1" stop-color="${colour}" stop-opacity="${opacity}"/></radialGradient>`,
    layer: `<rect ${SHEET} fill="url(#${id})"/>`,
  };
}

function blob(next: () => number, cx: number, cy: number, rx: number, ry: number): string {
  const points = Array.from({ length: 9 }, (_, i) => {
    const angle = (i / 9) * Math.PI * 2, scale = 0.8 + next() * 0.4;
    return [cx + Math.cos(angle) * rx * scale, cy + Math.sin(angle) * ry * scale] as const;
  });
  const mid = (a: readonly [number, number], b: readonly [number, number]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as const;
  const start = mid(points[8]!, points[0]!);
  return `M${start[0].toFixed(1)} ${start[1].toFixed(1)}${points.map((point, i) => {
    const end = mid(point, points[(i + 1) % 9]!);
    return `Q${point[0].toFixed(1)} ${point[1].toFixed(1)} ${end[0].toFixed(1)} ${end[1].toFixed(1)}`;
  }).join("")}Z`;
}

const plain: Builder = (p) => ({ palette: [p.ground, p.line], slots: {} });

const BUILDERS: Partial<Record<Finish, Builder>> = {
  paper: plain,
  aged: (p) => {
    const next = random(seedOf(`${p.seed}:aged`));
    const spot = p.paper ? "#8a5a2b" : "#000000";
    const spots = Array.from({ length: 12 }, () => `<circle cx="${(8 + next() * 234).toFixed(1)}" cy="${(8 + next() * 334).toFixed(1)}" r="${(1.5 + next() * 4.5).toFixed(1)}" fill="${spot}" opacity="${f((p.paper ? 0.06 : 0.1) + next() * 0.1)}"/>`).join("");
    const edge = vignette(p.id("agedVignette"), spot, p.paper ? 0.28 : 0.4);
    return { palette: p.paper ? ["#eadab9", p.line] : [mix(p.ground, "#3a2a14", 0.35), "#e8d6b0"], slots: { underlay: `<defs>${edge.defs}</defs>${spots}`, overlay: edge.layer } };
  },
  linen: (p) => {
    const weave = p.id("linenWeave");
    return { palette: [p.paper ? "#ece3cf" : p.ground, p.line], slots: { underlay: `<defs><pattern id="${weave}" patternUnits="userSpaceOnUse" width="3" height="3"><path d="M0 .75H3M0 2.25H3" stroke="${p.line}" stroke-width=".35" opacity=".1"/><path d="M.75 0V3M2.25 0V3" stroke="${p.line}" stroke-width=".35" opacity=".07"/></pattern></defs><rect ${SHEET} fill="url(#${weave})"/>` } };
  },
  vellum: (p) => {
    const mottle = textured("vellum", p.id, "#ffffff", p.paper ? 0.45 : 0.1);
    const edge = vignette(p.id("vellumVignette"), "#ffffff", p.paper ? 0.35 : 0.12);
    return { palette: [p.paper ? "#efe2c4" : mix(p.ground, "#ffffff", 0.06), p.line], slots: { underlay: `<defs>${mottle.defs}${edge.defs}</defs>${mottle.layer}`, overlay: edge.layer } };
  },
  watercolor: (p) => {
    const next = random(seedOf(`${p.seed}:wash`));
    const blur = p.id("wash");
    const tone = (colour: string) => (p.paper ? colour : mix(colour, "#ffffff", 0.35));
    const washes: Array<[number, number, number, number, string, number]> = [[125, 134, 50, 46, p.plate, 0.2], [125, 240, 72, 18, p.plate, 0.14]];
    if (p.seal && p.streak) washes.push([p.seal.x, p.seal.y, 17, 17, INKS[p.streak][1], 0.28]);
    const paths = washes.map(([x, y, rx, ry, colour, opacity]) => `<path d="${blob(next, x, y, rx, ry)}" fill="${tone(colour)}" opacity="${f(p.paper ? opacity : opacity * 1.2)}"/>`).join("");
    return { palette: [p.ground, p.line], slots: { underlay: `<defs><filter id="${blur}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5"/></filter></defs><g filter="url(#${blur})">${paths}</g>` } };
  },
  kraft: (p) => {
    const fibres = textured("kraft", p.id, p.paper ? "#5b4024" : "#000000", p.paper ? 0.3 : 0.35);
    return { palette: p.paper ? ["#caa97c", mix(p.plate, "#000000", 0.35)] : ["#3a2a1a", "#e9d6b4"], slots: { underlay: `<defs>${fibres.defs}</defs>${fibres.layer}` } };
  },
};

export function finishLayers(finish: Finish | undefined, context: FinishContext): FinishLayers {
  const [ground, line] = inks(context.ink, context.print);
  const [, plate, deep] = INKS[context.ink];
  const paint: Paint = { ...context, ground, line, plate, deep, paper: context.print === "paper", id: (name) => `rc-${name}-${context.seed}-${context.print}` };
  const layers = ((finish && BUILDERS[finish]) || plain)(paint);
  if (context.front) return layers;
  return { palette: [layers.palette[0], layers.palette[1].startsWith("url(") ? line : layers.palette[1]], slots: layers.slots };
}
