import type { DialGroup, DialSegment } from "../library/readerCardFacts.js";
import { random } from "./seed.js";

export const COUNTERS = ["dial", "beads", "shelf", "frame", "ring"] as const;
export type Counter = (typeof COUNTERS)[number];
export const SEAL_ANGLE = 135;

export interface CounterLayer { slot: "rings" | "top" | "frameBand"; svg: string }
export interface CounterOptions { seed: number; sealGap: boolean; lead: DialGroup | null }

const SEAL_HALF_WIDTH = 13;
const RING_GAP = 7;
const DASHES = ["", "1.2 .9", ".5 1.3", "2.6 1.2", ".25 2.2", "1.8 .6 .4 .6"];
const FRAME_LEGS: Array<[number, number, number, number]> = [[125, 13, 237, 13], [237, 13, 237, 337], [237, 337, 13, 337], [13, 337, 13, 13], [13, 13, 125, 13]];
const FRAME_CORNERS = [[13, 13], [237, 13], [13, 337], [237, 337]];

const f2 = (n: number) => n.toFixed(2);
const polar = (deg: number, r: number): [number, number] => [125 + r * Math.sin((deg * Math.PI) / 180), 134 - r * Math.cos((deg * Math.PI) / 180)];
const nearSeal = (deg: number) => Math.abs(((deg - SEAL_ANGLE + 540) % 360) - 180) < SEAL_HALF_WIDTH;
const booksIn = (segments: DialSegment[]) => segments.reduce((sum, segment) => sum + segment.books, 0);
const strokes = (d: string, attrs: string) => (d ? `<path class="pl" d="${d}" ${attrs}/>` : "");

function eachBook(segments: DialSegment[], visit: (deg: number, segment: DialSegment, i: number, step: number) => void) {
  const step = (360 - RING_GAP * segments.length) / booksIn(segments);
  let angle = RING_GAP / 2;
  for (const segment of segments) {
    for (let i = 0; i < segment.books; i++) visit(angle + step * (i + 0.5), segment, i, step);
    angle += step * segment.books + RING_GAP;
  }
}

function dial(segments: DialSegment[], { sealGap, lead }: CounterOptions): string {
  let heavy = "", light = "";
  eachBook(segments, (deg, segment, i) => {
    if (sealGap && nearSeal(deg)) return;
    const [x1, y1] = polar(deg, 62.5), [x2, y2] = polar(deg, i < segment.marked ? 72 : 67.5);
    const d = `M${f2(x1)} ${f2(y1)}L${f2(x2)} ${f2(y2)}`;
    if (segment.group === lead) heavy += d;
    else light += d;
  });
  return strokes(heavy, `stroke-width="1.15" stroke-linecap="round"`) + strokes(light, `stroke-width=".6" stroke-linecap="round" opacity=".8"`);
}

function beads(segments: DialSegment[], { sealGap, lead }: CounterOptions): string {
  let out = "";
  eachBook(segments, (deg, segment, i, step) => {
    if (sealGap && nearSeal(deg)) return;
    const r = Math.min(1.7, Math.max(0.42, step * 0.2));
    const [x, y] = polar(deg, 57.5);
    const filled = i < segment.marked;
    out += filled || segment.group === lead
      ? `<circle class="pf" cx="${f2(x)}" cy="${f2(y)}" r="${f2(r)}"${filled ? "" : ` opacity=".55"`}/>`
      : `<circle class="pl" cx="${f2(x)}" cy="${f2(y)}" r="${f2(r * 0.8)}" stroke-width="${f2(Math.min(0.5, r * 0.5))}"/>`;
  });
  return out;
}

function shelf(segments: DialSegment[], { seed, lead }: CounterOptions): string {
  const next = random(seed);
  const left = 36, right = 214, base = 66, gap = 2.4;
  const pitch = (right - left - gap * (segments.length - 1)) / booksIn(segments);
  const width = Math.max(0.35, pitch * 0.78);
  let x = left, out = "";
  for (const segment of segments) {
    const faint = lead !== null && segment.group !== lead ? ` opacity=".5"` : "";
    for (let i = 0; i < segment.books; i++) {
      const height = 7 + next() * 6;
      out += `<rect class="pf" x="${f2(x)}" y="${f2(base - height)}" width="${f2(width)}" height="${f2(height)}"${faint}/>`;
      if (i < segment.marked && pitch > 2) out += `<rect class="pg" x="${f2(x)}" y="${f2(base - height + 1.6)}" width="${f2(width)}" height=".7"/>`;
      x += pitch;
    }
    x += gap;
  }
  return `${out}<path class="pl" d="M30 ${base + 0.4}H220" stroke-width=".8"/>`;
}

function framePoint(distance: number): { x: number; y: number; horizontal: boolean } | null {
  let s = distance;
  for (const [ax, ay, bx, by] of FRAME_LEGS) {
    const length = Math.hypot(bx - ax, by - ay);
    if (s <= length) return { x: ax + ((bx - ax) * s) / length, y: ay + ((by - ay) * s) / length, horizontal: ay === by };
    s -= length;
  }
  return null;
}

function frame(segments: DialSegment[], { lead }: CounterOptions): string {
  const pitch = 3.1, gap = 5;
  let s = 0, heavy = "", light = "";
  fill: for (const segment of segments) {
    for (let i = 0; i < segment.books; i++) {
      let point = framePoint(s);
      while (point && FRAME_CORNERS.some(([cx, cy]) => Math.hypot(point!.x - cx!, point!.y - cy!) < 7)) {
        s += pitch;
        point = framePoint(s);
      }
      if (!point) break fill;
      const length = i < segment.marked ? 2.6 : 1.5;
      const d = point.horizontal ? `M${f2(point.x)} ${f2(point.y - length)}V${f2(point.y + length)}` : `M${f2(point.x - length)} ${f2(point.y)}H${f2(point.x + length)}`;
      if (segment.group === lead) heavy += d;
      else light += d;
      s += pitch;
    }
    s += gap;
  }
  return strokes(heavy, `stroke-width=".9"`) + strokes(light, `stroke-width=".55" opacity=".75"`);
}

function arc(a0: number, a1: number, attrs: string): string {
  const [x0, y0] = polar(a0, 57.5), [x1, y1] = polar(a1, 57.5);
  return `<path class="pl" d="M${f2(x0)} ${f2(y0)}A57.5 57.5 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${f2(x1)} ${f2(y1)}" ${attrs}/>`;
}

function ring(segments: DialSegment[], { sealGap, lead }: CounterOptions): string {
  const gap = 6, span = 360 - gap * segments.length, total = booksIn(segments);
  let angle = gap / 2, out = "";
  segments.forEach((segment, k) => {
    const isLead = segment.group === lead;
    const attrs = `stroke-width="${isLead ? 4.4 : 3.2}"${DASHES[k] ? ` stroke-dasharray="${DASHES[k]}"` : ""}${isLead ? "" : ` opacity=".8"`}`;
    const start = angle, end = angle + (span * segment.books) / total;
    const pieces: Array<[number, number]> = sealGap && start < SEAL_ANGLE + SEAL_HALF_WIDTH && end > SEAL_ANGLE - SEAL_HALF_WIDTH
      ? [[start, SEAL_ANGLE - SEAL_HALF_WIDTH], [SEAL_ANGLE + SEAL_HALF_WIDTH, end]]
      : [[start, end]];
    for (const [a0, a1] of pieces) if (a1 > a0) out += arc(a0, a1, attrs);
    angle = end + gap;
  });
  return out;
}

const DRAW: Record<Counter, [CounterLayer["slot"], (segments: DialSegment[], options: CounterOptions) => string]> = {
  dial: ["rings", dial],
  beads: ["rings", beads],
  shelf: ["top", shelf],
  frame: ["frameBand", frame],
  ring: ["rings", ring],
};

export function drawCounter(counter: Counter, segments: DialSegment[], options: CounterOptions): CounterLayer | null {
  const present = segments.filter((segment) => segment.books > 0);
  if (present.length === 0) return null;
  const [slot, draw] = DRAW[counter];
  return { slot, svg: draw(present, options) };
}
