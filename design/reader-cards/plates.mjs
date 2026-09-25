const SERIF = "'Playfair Display', Georgia, 'Times New Roman', serif";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export const PAPER = "#f1eadb";
export const REVERSED_LINE = "#efe5d1";

export const INKS = {
  carto: ["Prussian", "#1f4e6b", "#13324a"],
  anno: ["Oxblood", "#7a2e2a", "#4a1c19"],
  lamp: ["Bottle", "#2f5a3d", "#173524"],
  star: ["Plum", "#5b3b6e", "#2e1d3a"],
  arch: ["Ochre", "#7f5a16", "#45310c"],
  corr: ["Sepia", "#5b3f2e", "#33241a"],
  way: ["Verdigris", "#2b6664", "#123a39"],
  loyal: ["Madder", "#9a3b4f", "#4d1c28"],
  graph: ["Graphite", "#3b3a38", "#2a2826"],
};

export const PLATES = [
  { key: "carto", name: "Cartographer", epithet: "follows a world to its last page", numeral: "I" },
  { key: "anno", name: "Annotator", epithet: "reads with a pencil", numeral: "II" },
  { key: "lamp", name: "Lamplighter", epithet: "keeps company with mysteries", numeral: "III" },
  { key: "star", name: "Stargazer", epithet: "lives half in other worlds", numeral: "IV" },
  { key: "arch", name: "Archivist", epithet: "reads what happened", numeral: "V" },
  { key: "corr", name: "Correspondent", epithet: "writes back to the classics", numeral: "VI" },
  { key: "way", name: "Wayfarer", epithet: "never the same shelf twice", numeral: "VII" },
  { key: "loyal", name: "Loyalist", epithet: "returns to the same voices", numeral: "VIII" },
];

const STEP = 0.9;
const SHADOW = [-Math.SQRT1_2, Math.SQRT1_2];

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const quad = (a, c, b, t) => [(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]];
const cubic = (a, c1, c2, b, t) => [0, 1].map((k) => (1 - t) ** 3 * a[k] + 3 * (1 - t) ** 2 * t * c1[k] + 3 * (1 - t) * t * t * c2[k] + t ** 3 * b[k]);

function arcSegment(p0, rx, ry, degrees, largeArc, sweep, p1) {
  const phi = (degrees * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2, dy = (p0[1] - p1[1]) / 2;
  const x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const coef = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cx1 = (coef * rx * y1) / ry, cy1 = (-coef * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0[0] + p1[0]) / 2, cy = sin * cx1 + cos * cy1 + (p0[1] + p1[1]) / 2;
  const angle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const start = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  return {
    at: (t) => {
      const a = start + delta * t, x = rx * Math.cos(a), y = ry * Math.sin(a);
      return [cx + cos * x - sin * y, cy + sin * x + cos * y];
    },
    length: (Math.abs(delta) * (rx + ry)) / 2,
  };
}

function subpaths(d) {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  const out = [];
  let i = 0, cmd = "", cur = [0, 0], start = [0, 0], control = null, points = null;
  const num = () => Number(tokens[i++]);
  const add = (at, length) => {
    const n = Math.max(2, Math.ceil(length / STEP));
    for (let k = 1; k <= n; k++) points.push(at(k / n));
  };
  const flush = (closed) => {
    if (points && closed) {
      add((t) => lerp(cur, start, t), dist(cur, start));
      if (dist(points[0], points[points.length - 1]) < 0.01) points.pop();
    }
    if (points && points.length > 1) out.push({ points, closed });
    points = null;
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    const upper = cmd.toUpperCase();
    const [ox, oy] = cmd === upper ? [0, 0] : cur;
    if (upper === "Z") {
      flush(true);
      cur = start;
      control = null;
      continue;
    }
    if (upper === "M") {
      flush(false);
      cur = start = [num() + ox, num() + oy];
      points = [cur];
      cmd = cmd === upper ? "L" : "l";
      control = null;
      continue;
    }
    if (!points) points = [cur];
    const from = cur;
    if (upper === "L" || upper === "H" || upper === "V") {
      cur = upper === "L" ? [num() + ox, num() + oy] : upper === "H" ? [num() + ox, from[1]] : [from[0], num() + oy];
      add((t) => lerp(from, cur, t), dist(from, cur));
      control = null;
    } else if (upper === "Q" || upper === "T") {
      const c = upper === "Q" ? [num() + ox, num() + oy] : control ? [2 * from[0] - control[0], 2 * from[1] - control[1]] : from;
      cur = [num() + ox, num() + oy];
      const to = cur;
      add((t) => quad(from, c, to, t), dist(from, c) + dist(c, to));
      control = c;
    } else if (upper === "C") {
      const c1 = [num() + ox, num() + oy], c2 = [num() + ox, num() + oy];
      cur = [num() + ox, num() + oy];
      const to = cur;
      add((t) => cubic(from, c1, c2, to, t), dist(from, c1) + dist(c1, c2) + dist(c2, to));
      control = null;
    } else if (upper === "A") {
      const rx = num(), ry = num(), rotation = num(), largeArc = num(), sweep = num();
      cur = [num() + ox, num() + oy];
      const arc = arcSegment(from, rx, ry, rotation, largeArc, sweep, cur);
      add(arc.at, arc.length);
      control = null;
    } else {
      throw new Error(`Unsupported path command "${cmd}" in ${d}`);
    }
  }
  flush(false);
  return out;
}

const round = (n) => Math.round(n * 10) / 10;
const pointList = (points) => points.map(([x, y]) => `${round(x)} ${round(y)}`).join("L");
const lengths = (points) => points.reduce((acc, p, i) => [...acc, i ? acc[i - 1] + dist(points[i - 1], p) : 0], []);

function tangents(points, closed) {
  const n = points.length;
  return points.map((_, i) => {
    const a = points[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const b = points[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const length = dist(a, b) || 1;
    return [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  });
}

function ribbon(points, widths, closed = false) {
  const tangent = tangents(points, closed);
  const side = (s) => points.map(([x, y], i) => [x - (s * tangent[i][1] * widths[i]) / 2, y + (s * tangent[i][0] * widths[i]) / 2]);
  const left = side(1), right = side(-1).reverse();
  return closed ? `M${pointList(left)}ZM${pointList(right)}Z` : `M${pointList([...left, ...right])}Z`;
}

function shadowWidths(points, min, max) {
  const area = points.reduce((sum, [x, y], i) => {
    const [x2, y2] = points[(i + 1) % points.length];
    return sum + x * y2 - x2 * y;
  }, 0);
  const sign = area > 0 ? 1 : -1;
  return tangents(points, true).map(([tx, ty]) => min + (max - min) * Math.max(0, sign * ty * SHADOW[0] - sign * tx * SHADOW[1]));
}

function swellWidths(points, min, max) {
  const s = lengths(points), total = s[s.length - 1] || 1;
  return s.map((d) => min + (max - min) * Math.sin((Math.PI * d) / total) ** 0.7);
}

function inside([x, y], polygon) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function runsInside(points, polygon) {
  const runs = [];
  let run = [];
  for (const p of points) {
    if (inside(p, polygon)) run.push(p);
    else {
      if (run.length > 1) runs.push(run);
      run = [];
    }
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

const inkPath = (d, w) => subpaths(d)
  .map(({ points, closed }) => closed ? ribbon(points, shadowWidths(points, 0.45 * w, 1.75 * w), true) : ribbon(points, swellWidths(points, 0.15 * w, 1.45 * w)))
  .join("");

const ink = (d, w, attrs = "") => `<path class="pf" d="${inkPath(d, w)}"${attrs}/>`;
const cut = (d, w, attrs = "") => `<path class="pgf" d="${inkPath(d, w)}"${attrs}/>`;
const form = (d, w, attrs = "") => `<path class="pgf" d="${d}"${attrs}/>${ink(d, w, attrs)}`;

function hatch(d, max, clip, weight = () => max) {
  const polygon = clip ? subpaths(clip)[0].points : null;
  let out = "";
  for (const { points } of subpaths(d)) {
    for (const run of polygon ? runsInside(points, polygon) : [points]) {
      const s = lengths(run), total = s[s.length - 1];
      if (total < 1.5) continue;
      out += ribbon(run, run.map((p, i) => Math.max(0.04, weight(p) * Math.sqrt(Math.min(1, s[i] / 2.2) * Math.min(1, (total - s[i]) / 2.2)))));
    }
  }
  return `<path class="pf" d="${out}"/>`;
}

const rect = (x, y, w, h) => `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
const ellipse = (cx, cy, rx, ry) => `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
const circle = (cx, cy, r) => ellipse(cx, cy, r, r);
const fourPointStar = (x, y, r = 4) => `M${x} ${y - r}L${x + r / 4} ${y - r / 4}L${x + r} ${y}L${x + r / 4} ${y + r / 4}L${x} ${y + r}L${x - r / 4} ${y + r / 4}L${x - r} ${y}L${x - r / 4} ${y - r / 4}Z`;

export const emblems = {
  carto: () => {
    const graticule = [ellipse(125, 134, 55, 20), ellipse(125, 134, 55, 40), ellipse(125, 134, 20, 55), ellipse(125, 134, 40, 55), "M70 134H180M125 79V189"].map((d) => ink(d, 0.5));
    const s = 21.2;
    const shorts = [
      `M125 134L125 127L${125 + s} ${134 - s}L132 134Z`,
      `M125 134L132 134L${125 + s} ${134 + s}L125 141Z`,
      `M125 134L125 141L${125 - s} ${134 + s}L118 134Z`,
      `M125 134L118 134L${125 - s} ${134 - s}L125 127Z`,
    ].map((d) => form(d, 1));
    const a = 120.05, b = 129.95, u = 129.05, v = 138.95;
    const longs = [
      [`M125 134L125 84L${a} ${u}Z`, `M125 134L125 84L${b} ${u}Z`],
      [`M125 134L175 134L${b} ${u}Z`, `M125 134L175 134L${b} ${v}Z`],
      [`M125 134L125 184L${b} ${v}Z`, `M125 134L125 184L${a} ${v}Z`],
      [`M125 134L75 134L${a} ${v}Z`, `M125 134L75 134L${a} ${u}Z`],
    ].map(([fill, open]) => `<path class="pf" d="${fill}"/>${form(open, 1)}`);
    return [...graticule, ...shorts, ...longs, form(circle(125, 134, 5), 1), `<circle class="pf" cx="125" cy="134" r="2"/>`].join("");
  },
  anno: () => [
    form("M76 152Q100 143 125 151L125 178Q100 170 76 179Z", 1.3),
    form("M125 151Q150 143 174 152L174 179Q150 170 125 178Z", 1.3),
    ink("M84 158Q101 152 118 157M84 164Q101 158 118 163M84 170Q101 164 118 169M134 157Q150 152 166 158M134 169Q150 164 166 170", 0.6),
    ink("M134 163.2Q150 158 166 164", 1.8),
    ink("M131 154.5h-2.6v19h2.6", 1.2),
    `<path class="pf" d="M141 142Q98 130 92 86Q128 104 141 142Z"/>`,
    cut("M131 131L117 133M124 120L108 121M117 109L101 108M109 98L96 96M134 126L137 112M126 114L128 100M118 103L119 92", 0.9),
    ink("M149 153L90 83", 1.3),
    `<path class="pf" d="M145.5 148.5L151.5 157.5L149 150.5Z"/>`,
  ].join(""),
  lamp: () => {
    const rays = [0, 180, -20, -160, 20, 160, -45, -135].map((deg) => {
      const t = (deg * Math.PI) / 180;
      const p = (r) => [125 + r * Math.cos(t), 126 + r * Math.sin(t)].map((n) => n.toFixed(1)).join(" ");
      return `M${p(29)}L${p(39)}`;
    }).join("");
    return [
      ink(rays, 0.9),
      ink(circle(125, 84, 6), 1.4),
      `<path class="pf" d="M109 101L141 101L134 90L116 90Z"/>`,
      form(rect(107, 101, 36, 50), 1.4),
      ink("M113 101V151M137 101V151", 0.7),
      `<path class="pf" d="M125 110C133 121 134 131 125 140C116 131 117 121 125 110Z"/>`,
      `<path class="pgf" d="M125 123C128 128 128 132 125 136C122 132 122 128 125 123Z"/>`,
      `<path class="pf" d="M105 151L145 151L141 159L109 159Z"/>`,
      ink("M113 159V164H137V159", 1.2),
      `<path class="pf" d="${fourPointStar(152, 92)}${fourPointStar(98, 176)}"/>`,
    ].join("");
  },
  star: () => {
    const crescent = "M121.96 90.19A40 40 0 1 0 152.22 150.71A34 34 0 1 1 121.96 90.19Z";
    const belly = [Math.cos((153.5 * Math.PI) / 180), Math.sin((153.5 * Math.PI) / 180)];
    const shade = ([x, y]) => {
      const dx = x - 118, dy = y - 130, r = Math.hypot(dx, dy) || 1;
      const tone = 0.2 + 0.6 * (r / 40) ** 2 + (0.35 * (dx * belly[0] + dy * belly[1])) / r;
      return 0.16 + Math.min(1, Math.max(0.1, tone));
    };
    let lines = "";
    for (let k = 166; k <= 332; k += 3.1) lines += `M${(k - 174).toFixed(1)} 174L${(k - 86).toFixed(1)} 86`;
    return [
      hatch(lines, 1, crescent, shade),
      ink(crescent, 1.3),
      `<g transform="rotate(-18 147 106)">${ink("M133 106A14 3.8 0 0 1 161 106", 0.8)}</g>`,
      `<circle class="pf" cx="147" cy="106" r="7"/>`,
      `<g transform="rotate(-18 147 106)"><path class="pgs" d="M133 106A14 3.8 0 0 0 161 106" stroke-width="2.8"/>${ink("M133 106A14 3.8 0 0 0 161 106", 1.1)}</g>`,
      `<path class="pf" d="${fourPointStar(166, 128)}${fourPointStar(157, 153, 3.2)}"/>`,
      `<circle class="pf" cx="139" cy="85" r="1.2"/><circle class="pf" cx="171" cy="146" r="1.1"/>`,
    ].join("");
  },
  arch: () => {
    let caps = "";
    for (let x = 102; x <= 148; x += 3) caps += `M${x} 86.5V90.5M${x} 173.5V177.5`;
    return [
      form(rect(99, 85, 52, 7), 1.3),
      form(rect(99, 172, 52, 7), 1.3),
      hatch(caps, 0.75),
      ink("M104 92V172M146 92V172", 1.3),
      `<circle class="pf" cx="104" cy="132" r="2.4"/><circle class="pf" cx="146" cy="132" r="2.4"/>`,
      form("M110 92C110 114 120 124 123 132C120 140 110 150 110 172H140C140 150 130 140 127 132C130 124 140 114 140 92Z", 1.3),
      `<path class="pf" d="M113.5 106C116 117 121 125 124 130H126C129 125 134 117 136.5 106Z"/>`,
      `<path class="pl" d="M125 130V160" stroke-width=".8" stroke-dasharray="1.5 1.5"/>`,
      `<path class="pf" d="M112 172C114 163 119 158 125 157C131 158 136 163 138 172Z"/>`,
      ink("M114.5 96C114.5 104 116 110 118.5 115M114.5 168C114.5 160 116 154 118.5 149", 0.6),
    ].join("");
  },
  corr: () => {
    let flap = "";
    for (let y = 113; y <= 139; y += 3) {
      const hw = 43 - (y - 110) * (43 / 32);
      flap += `M${(125 - hw + 1.2).toFixed(1)} ${y}H${(125 + hw - 1.2).toFixed(1)}`;
    }
    const leaf = "M0 0Q3.4-4.8 0-10.5Q-3.4-4.8 0 0Z";
    const leaves = [[101.9, 96.7], [111.8, 93.9], [119.7, 92.7]].flatMap(([x, y]) => [
      form(leaf, 0.9, ` transform="translate(${x} ${y}) rotate(-52)"`),
      form(leaf, 0.9, ` transform="translate(${250 - x} ${y}) rotate(52)"`),
      form(leaf, 0.9, ` transform="translate(${x} ${y}) rotate(-128) scale(.8)"`),
      form(leaf, 0.9, ` transform="translate(${250 - x} ${y}) rotate(128) scale(.8)"`),
    ]).join("");
    return [
      ink("M92 101Q125 84 158 101", 1),
      leaves,
      form(rect(82, 110, 86, 54), 1.4),
      hatch(flap, 0.8),
      ink("M82 164L115 137M168 164L135 137", 0.6),
      ink("M82 110L125 142L168 110", 1.2),
      `<circle class="pf" cx="125" cy="142" r="11"/><path class="pf" d="M117.5 149.5Q116 156 119.5 157Q121.5 153 120.5 150ZM132 150.5Q134 155 131.5 156.5Q129.5 154 129.8 151.5Z"/>`,
      `<circle class="pgs" cx="125" cy="142" r="7.6" stroke-width=".8"/><path class="pgf" d="M125 137.6L128.4 142L125 146.4L121.6 142Z"/>`,
    ].join("");
  },
  way: () => {
    const jib = [[100, 131.5], [104, 123.5], [108, 116], [112, 109.5], [116, 103.5], [120, 97.5]].map(([x, y]) => `M${x} ${y + 1.8}V142.5`).join("");
    return [
      ink("M125 83V149", 1.4),
      `<path class="pf" d="M125 83L139 86.5L125 90Z"/>`,
      form("M127 90L127 144L160 144Q151 114 127 90Z", 1.3),
      ink("M127 109H142.5M127 125H151.5", 0.6),
      form("M123 94L123 144L94 144Q104 118 123 94Z", 1.3),
      hatch(jib, 0.8),
      `<path class="pf" d="M86 148H164L153 163H97Z"/>`,
      cut("M93 152.5H157", 0.9),
      ink("M84 170q8-5 16 0t16 0t16 0t16 0t16 0", 1.1),
      ink("M96 177q7-4 14 0t14 0t14 0t14 0", 0.6),
    ].join("");
  },
  loyal: () => {
    const wingUp = "M-18-5Q-12-30 12-44Q2-24-2-4Z";
    const wingDown = "M-18 5Q-12 30 12 44Q2 24-2 4Z";
    let lines = "";
    for (let x = -18; x <= 13; x += 2.8) lines += `M${x.toFixed(1)}-46V46`;
    return [
      `<path class="pl" d="M164.3 161.5A48 48 0 0 1 85.7 161.5" stroke-width=".9" stroke-dasharray="1.4 3.2" stroke-linecap="round"/>`,
      ink("M86.1 166.5L85.7 161.5L90.2 163.6", 0.9),
      `<g transform="translate(125 131) rotate(-22)">`,
      form(wingUp, 1.3),
      hatch(lines, 0.75, wingUp),
      form(wingDown, 1.3),
      hatch(lines, 0.75, wingDown),
      `<path class="pf" d="M2-3L44-15L15 1L44 17L2 5Z"/>`,
      `<path class="pf" d="M-40-1Q-20-9 6-3Q11 1 6 5Q-18 9-40 3Z"/>`,
      `<circle class="pf" cx="-35" cy="1" r="6"/><circle class="pgf" cx="-37" cy="-.5" r="1.2"/>`,
      `<path class="pf" d="M-41 0L-47 1.5L-41 3Z"/>`,
      `</g>`,
    ].join("");
  },
  none: () => `<circle class="pl" cx="125" cy="134" r="38" stroke-width=".8" stroke-dasharray="2 4"/><text class="pt" x="125" y="137.5" text-anchor="middle" font-size="9" letter-spacing="2.4" font-family="${SANS}">NOT YET</text>`,
};

export function plate({ key, emblem = key, name, eyebrow = "THE", epithet, numeral, reader = "EXAMPLE READER", width = 250, label }) {
  const corners = [[16, 16], [234, 16], [16, 334], [234, 334]].map(([x, y]) => `M${x} ${y - 4.5}L${x + 4.5} ${y}L${x} ${y + 4.5}L${x - 4.5} ${y}Z`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" class="plate id-${key}" viewBox="0 0 250 350" width="${width}" height="${+(width * 1.4).toFixed(2)}" role="img" aria-label="${label ?? `${eyebrow.toLowerCase()} ${name} identity plate`}">
<rect class="pg" width="250" height="350" rx="4"/>
<rect class="pl" x="10" y="10" width="230" height="330" stroke-width="1.6"/>
<rect class="pl" x="16" y="16" width="218" height="318" stroke-width=".6"/>
<path class="pf" d="${corners}"/>
<text class="pt" x="125" y="45" text-anchor="middle" font-size="8.5" letter-spacing="3.4" font-family="${SANS}" font-weight="600">EX LIBRIS</text>
<circle class="pl" cx="125" cy="134" r="60" stroke-width="1.4"/>
<circle class="pl" cx="125" cy="134" r="55" stroke-width=".6"/>
${emblems[emblem]()}
<text class="pt" x="125" y="220" text-anchor="middle" font-size="8" letter-spacing="3" font-family="${SANS}" font-weight="600">${eyebrow}</text>
<text class="pt" x="125" y="247" text-anchor="middle" font-size="25" font-family="${SERIF}">${name}</text>
<path class="pl" d="M82 263H117M133 263H168" stroke-width=".8"/><circle class="pf" cx="125" cy="263" r="2"/>
<text class="pt" x="125" y="283" text-anchor="middle" font-size="11" font-style="italic" font-family="${SERIF}">${epithet}</text>
<path class="pl" d="M30 305H220" stroke-width=".5"/>
<text class="pt" x="30" y="321" font-size="7.5" letter-spacing="1.8" font-family="${SANS}" font-weight="600">PLATE ${numeral}</text>
<text class="pt" x="220" y="321" text-anchor="end" font-size="7.5" letter-spacing="1.8" font-family="${SANS}" font-weight="600">${reader}</text>
</svg>`;
}

const glyphShapes = {
  carto: `<path class="gg" d="M24 7.5L27.2 20.8L40.5 24L27.2 27.2L24 40.5L20.8 27.2L7.5 24L20.8 20.8Z"/><path class="gg" d="M24 24L31.5 16.5L28 24ZM24 24L31.5 31.5L24 28ZM24 24L16.5 31.5L20 24ZM24 24L16.5 16.5L24 20Z" opacity=".55"/><circle class="gi" cx="24" cy="24" r="2"/>`,
  anno: `<path class="gg" d="M35 9.5Q34 26 18.5 34Q20.5 18 35 9.5Z"/><path class="gs" d="M35.5 9L13.5 38.5" stroke-width="1.6" stroke-linecap="round"/><path class="gs" d="M31 37h-2.5v-6" stroke-width="1.4" fill="none"/>`,
  lamp: `<circle class="gs" cx="24" cy="10.5" r="2.4" stroke-width="1.3" fill="none"/><path class="gg" d="M17.5 17H30.5L28 13.2H20Z"/><rect class="gg" x="17" y="17" width="14" height="15.5"/><path class="gi" d="M24 19.5C27 23.5 27 27.2 24 30.2C21 27.2 21 23.5 24 19.5Z"/><path class="gg" d="M15.5 32.5H32.5L30.5 36H17.5Z"/>`,
  star: `<path class="gg" d="M20.94 13.04A12 12 0 1 0 33.44 28.66A10 10 0 1 1 20.94 13.04Z"/><path class="gg" d="M33.5 11.5L34.4 14.6L37.5 15.5L34.4 16.4L33.5 19.5L32.6 16.4L29.5 15.5L32.6 14.6Z"/>`,
  arch: `<path class="gg" d="M14.5 10.5H33.5V13.5H14.5ZM14.5 34.5H33.5V37.5H14.5Z"/><path class="gg" d="M17 13.5C17 20 22.5 22 23 24C22.5 26 17 28 17 34.5H31C31 28 25.5 26 25 24C25.5 22 31 20 31 13.5Z"/><path class="gi" d="M19.8 17H28.2C27.2 20 25 22 24 22.8C23 22 20.8 20 19.8 17ZM19 34.5C19.8 30.8 22 29.4 24 29.2C26 29.4 28.2 30.8 29 34.5Z"/>`,
  corr: `<rect class="gg" x="10" y="14.5" width="28" height="19.5" rx=".8"/><path class="gk" d="M10.5 15L24 25.5L37.5 15" stroke-width="1.5" fill="none" stroke-linejoin="round"/><circle class="gi" cx="24" cy="26" r="4.2"/>`,
  way: `<path class="gs" d="M24 8.5V31" stroke-width="1.5"/><path class="gg" d="M24 8.5L29.5 10L24 11.5Z"/><path class="gg" d="M25.2 12V28.5H35.5Q33 19 25.2 12Z"/><path class="gg" d="M22.8 13.5V28.5H13Q16 20 22.8 13.5Z"/><path class="gg" d="M10.5 30H37.5L34 35H14Z"/><path class="gs" d="M12 39q3-2 6 0t6 0t6 0t6 0" stroke-width="1.3" fill="none"/>`,
  loyal: `<g transform="translate(24 23.5) rotate(-22) scale(.36)"><path class="gg" d="M-18-5Q-12-30 12-44Q2-24-2-4ZM-18 5Q-12 30 12 44Q2 24-2 4ZM2-3L44-15L15 1L44 17L2 5ZM-40-1Q-20-9 6-3Q11 1 6 5Q-18 9-40 3Z"/><circle class="gg" cx="-35" cy="1" r="7"/></g>`,
};

export const glyph = (key, size, extra = "") => `<svg xmlns="http://www.w3.org/2000/svg" class="glyph id-${key} ${extra}" viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true"><circle class="gd" cx="24" cy="24" r="23.5"/><circle class="gr" cx="24" cy="24" r="20.5" fill="none" stroke-width=".8"/>${glyphShapes[key]}</svg>`;

export const printStyle = (ground, line) => `<style>.pg,.pgf,.gg{fill:${ground}}.pl{stroke:${line};fill:none}.pf,.pt,.gd,.gi{fill:${line}}.pgl{fill:${ground};stroke:${line}}.pgs,.gr,.gs{stroke:${ground};fill:none}.gk{stroke:${line};fill:none}</style>`;
