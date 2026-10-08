import type { CornerStyle } from "./style.js";

type Draw = (sx: number, sy: number, cx: number, cy: number) => string;

const n = (value: number) => +value.toFixed(2);
const CORNERS: ReadonlyArray<readonly [number, number, number, number]> = [[16, 16, 1, 1], [234, 16, -1, 1], [16, 334, 1, -1], [234, 334, -1, -1]];
const at = (draw: Draw) => CORNERS.map(([cx, cy, sx, sy]) => draw(sx, sy, cx, cy)).join("");
const star4 = (x: number, y: number, r: number, k = 0.24) => `M${n(x)} ${n(y - r)}L${n(x + r * k)} ${n(y - r * k)}L${n(x + r)} ${n(y)}L${n(x + r * k)} ${n(y + r * k)}L${n(x)} ${n(y + r)}L${n(x - r * k)} ${n(y + r * k)}L${n(x - r)} ${n(y)}L${n(x - r * k)} ${n(y - r * k)}Z`;

const DRAW: Record<Exclude<CornerStyle, "diamonds" | "none">, Draw> = {
  deco: (sx, sy, cx, cy) => `<path class="pl" d="M${cx + 6 * sx} ${cy + 22 * sy}V${cy + 6 * sy}H${cx + 22 * sx}M${cx + 8 * sx} ${cy + 14 * sy}V${cy + 8 * sy}H${cx + 14 * sx}" stroke-width=".9"/><rect class="pf" x="${cx + (sx > 0 ? 2 : -5)}" y="${cy + (sy > 0 ? 2 : -5)}" width="3" height="3"/>`,
  fleuron: (sx, sy, cx, cy) => `<circle class="pf" cx="${cx + 7 * sx}" cy="${cy + 7 * sy}" r="2.6"/><path class="pf" d="M${cx + 10 * sx} ${cy + 7 * sy}Q${cx + 20 * sx} ${cy + 3 * sy} ${cx + 26 * sx} ${cy + 8 * sy}Q${cx + 18 * sx} ${cy + 10 * sy} ${cx + 10 * sx} ${cy + 7 * sy}ZM${cx + 7 * sx} ${cy + 10 * sy}Q${cx + 3 * sx} ${cy + 20 * sy} ${cx + 8 * sx} ${cy + 26 * sy}Q${cx + 11 * sx} ${cy + 18 * sy} ${cx + 7 * sx} ${cy + 10 * sy}Z" opacity=".85"/>`,
  photo: (sx, sy) => {
    const x0 = sx > 0 ? 10 : 240, y0 = sy > 0 ? 10 : 340;
    return `<path class="pf" d="M${x0} ${y0}L${x0 + 28 * sx} ${y0}L${x0} ${y0 + 28 * sy}Z"/><path class="pgs" d="M${x0 + 22 * sx} ${n(y0 + 2.5 * sy)}L${n(x0 + 2.5 * sx)} ${y0 + 22 * sy}" stroke-width=".7"/>`;
  },
  stars: (sx, sy, cx, cy) => `<path class="pf" d="${star4(cx, cy, 7)}"/><path class="pf" d="${star4(cx + 14 * sx, cy, 2.6)}${star4(cx, cy + 14 * sy, 2.6)}"/>`,
  laurel: (sx, sy, cx, cy) => {
    const A = [cx + 30 * sx, cy + 3 * sy], C = [cx + 5 * sx, cy + 5 * sy], B = [cx + 3 * sx, cy + 30 * sy];
    const q = (t: number, k: 0 | 1) => (1 - t) ** 2 * A[k]! + 2 * (1 - t) * t * C[k]! + t * t * B[k]!;
    const dq = (t: number, k: 0 | 1) => 2 * (1 - t) * (C[k]! - A[k]!) + 2 * t * (B[k]! - C[k]!);
    let leaves = "";
    for (const t of [0.1, 0.18, 0.46, 0.6, 0.74, 0.88]) {
      const x = n(q(t, 0)), y = n(q(t, 1)), angle = (Math.atan2(dq(t, 1), dq(t, 0)) * 180) / Math.PI;
      for (const side of [-1, 1]) leaves += `<ellipse class="pf" cx="${x}" cy="${y}" rx="3" ry="1.15" transform="rotate(${(angle + side * 38).toFixed(1)} ${x} ${y}) translate(2.4 0)"/>`;
    }
    return `<path class="pl" d="M${A[0]} ${A[1]}Q${C[0]} ${C[1]} ${B[0]} ${B[1]}" stroke-width=".7"/>${leaves}<circle class="pf" cx="${cx}" cy="${cy}" r="1.6"/>`;
  },
  knot: (sx, sy, cx, cy) => {
    const x = cx + 5 * sx, y = cy + 5 * sy;
    return `<circle class="pg" cx="${cx}" cy="${cy}" r="9"/><ellipse class="pl" cx="${x}" cy="${y}" rx="8" ry="3.2" transform="rotate(45 ${x} ${y})" stroke-width="1"/><ellipse class="pl" cx="${x}" cy="${y}" rx="8" ry="3.2" transform="rotate(-45 ${x} ${y})" stroke-width="1"/><circle class="pf" cx="${x}" cy="${y}" r="1.3"/>`;
  },
  volute: (sx, sy, cx, cy) => {
    const p = (u: number, v: number) => `${n(cx + u * sx)} ${n(cy + v * sy)}`;
    const sweep = sx * sy > 0 ? 0 : 1;
    return `<path class="pl" d="M${p(28, 3)}Q${p(10, 3)} ${p(6, 6)}A2.4 2.4 0 1 ${sweep} ${p(9, 7.8)}A1.2 1.2 0 1 ${sweep} ${p(7.2, 6.3)}M${p(3, 28)}Q${p(3, 10)} ${p(6, 6)}" stroke-width=".9" stroke-linecap="round"/>`;
  },
  meander: (sx, sy, cx, cy) => {
    const p = (u: number, v: number) => `${cx + u * sx} ${cy + v * sy}`;
    return `<path class="pl" d="M${p(2, 26)}V${cy + 2 * sy}H${cx + 26 * sx}M${p(6, 22)}V${cy + 6 * sy}H${cx + 22 * sx}V${cy + 8 * sy}H${cx + 17 * sx}" stroke-width=".8" stroke-linejoin="miter"/>`;
  },
  rosette: (_sx, _sy, cx, cy) => {
    let petals = "";
    for (let k = 0; k < 8; k++) petals += `<ellipse class="pf" cx="${n(cx + 3.6)}" cy="${cy}" rx="3.2" ry="1.25" transform="rotate(${k * 45} ${cx} ${cy})"/>`;
    return `<circle class="pg" cx="${cx}" cy="${cy}" r="7.6"/>${petals}<circle class="pg" cx="${cx}" cy="${cy}" r="1.3"/>`;
  },
  register: (_sx, _sy, cx, cy) => `<circle class="pgl" cx="${cx}" cy="${cy}" r="5.5" stroke-width=".7"/><circle class="pl" cx="${cx}" cy="${cy}" r="2.4" stroke-width=".5"/><path class="pl" d="M${cx - 8} ${cy}H${cx + 8}M${cx} ${cy - 8}V${cy + 8}" stroke-width=".5"/>`,
};

export function cornersSlot(corners: CornerStyle): string | undefined {
  if (corners === "diamonds") return undefined;
  if (corners === "none") return "";
  return at(DRAW[corners]);
}
