import { themes, type ThemeColors, type ThemeId } from "./palettes.js";

export type DecorAnchor = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "top" | "bottom";

export interface DecorPiece {
  anchor: DecorAnchor;
  width: number | "full";
  height: number;
  svg: string;
}

export interface DecorFrameLine {
  inset: number;
  width: number;
  radius: number;
  opacity: number;
}

export interface DecorFrame {
  color: string;
  lines: readonly DecorFrameLine[];
}

export interface Decor {
  pieces: readonly DecorPiece[];
  frame?: DecorFrame;
}

export const DECOR_MAX_OPACITY = 0.25;
export const DECOR_EXTRA_COLORS = { orange: "#d9702b", rust: "#a8432a" } as const;

const MATRIX_GLYPHS = "アイウエオカキ01クケコサシ7スセ9ZタチツテトX";
const EDGE = 'vector-effect="non-scaling-stroke"';

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function svg(width: number, height: number, body: string, stretch = false): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"${stretch ? ' preserveAspectRatio="none"' : ""}>${body}</svg>`;
}

export function withOpacity(hex: string, opacity: number): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function matrix(c: ThemeColors): Decor {
  const columns: Array<[number, number]> = [[8, 5], [32, 9], [56, 6], [80, 12], [104, 8]];
  let k = 0;
  const glyphs = columns.flatMap(([x, rows]) =>
    Array.from({ length: rows }, (_, row) => {
      const glyph = MATRIX_GLYPHS[(k++ * 7) % MATRIX_GLYPHS.length];
      return `<text x="${x}" y="${16 + row * 20}" font-family="monospace" font-size="16" fill="${c.accent}" opacity="${round(0.02 + 0.19 * (1 - row / rows))}">${glyph}</text>`;
    }),
  );
  return { pieces: [{ anchor: "top-right", width: 128, height: 248, svg: svg(128, 248, glyphs.join("")) }] };
}

function synthwave(c: ThemeColors): Decor {
  const slices = [[40, 2], [46, 3], [52, 4]].map(([y, h]) => `<rect x="0" y="${y}" width="120" height="${h}" fill="${c.background}"/>`).join("");
  const sun = svg(120, 104, `<path d="M8 56 A52 52 0 0 1 112 56 Z" fill="${c.accent}" opacity="0.15"/>${slices}`);
  const line = (x1: number, y1: number, x2: number, y2: number, opacity: number) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c.accent}" stroke-width="1" opacity="${opacity}" ${EDGE}/>`;
  const horizontals = [line(0, 0.5, 360, 0.5, 0.24), ...[8, 18, 31, 47].map((y) => line(0, y, 360, y, 0.15))];
  const verticals = Array.from({ length: 23 }, (_, i) => i - 11).map((k) => line(180 + k * 16, 0, 180 + k * 80, 48, 0.14));
  const grid = svg(360, 48, [...horizontals, ...verticals].join(""), true);
  return {
    pieces: [
      { anchor: "bottom-right", width: 120, height: 104, svg: sun },
      { anchor: "bottom", width: "full", height: 48, svg: grid },
    ],
  };
}

function seventies(c: ThemeColors): Decor {
  const arcs: Array<[number, string]> = [[68, c.accent], [92, DECOR_EXTRA_COLORS.orange], [116, DECOR_EXTRA_COLORS.rust]];
  const body = arcs.map(([r, color]) => `<circle cx="140" cy="-8" r="${r}" fill="none" stroke="${color}" stroke-width="18" opacity="0.22"/>`).join("");
  return { pieces: [{ anchor: "top-right", width: 136, height: 136, svg: svg(136, 136, body) }] };
}

function newsprint(c: ThemeColors): Decor {
  const rule = svg(
    360,
    10,
    `<line x1="0" y1="1.5" x2="360" y2="1.5" stroke="${c.text}" stroke-width="2.4" opacity="0.25" ${EDGE}/><line x1="0" y1="7.5" x2="360" y2="7.5" stroke="${c.text}" stroke-width="0.9" opacity="0.25" ${EDGE}/>`,
    true,
  );
  const dots: string[] = [];
  for (let x = 6; x <= 136; x += 12) {
    for (let y = 6; y <= 136; y += 12) {
      const r = round(5.2 * (1 - Math.hypot(136 - x, 136 - y) / 132));
      if (r >= 0.6) dots.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${c.text}" opacity="0.08"/>`);
    }
  }
  return {
    pieces: [
      { anchor: "top", width: "full", height: 10, svg: rule },
      { anchor: "bottom-right", width: 136, height: 136, svg: svg(136, 136, dots.join("")) },
    ],
  };
}

function oxblood(c: ThemeColors): Decor {
  const diamond = svg(34, 34, `<path d="M17 11L23 17L17 23L11 17Z" fill="${c.accent}" opacity="0.25"/>`);
  const corners: DecorAnchor[] = ["top-left", "top-right", "bottom-left", "bottom-right"];
  return {
    pieces: corners.map((anchor) => ({ anchor, width: 34, height: 34, svg: diamond })),
    frame: {
      color: c.accent,
      lines: [
        { inset: 10, width: 1.5, radius: 16, opacity: 0.2 },
        { inset: 17, width: 0.75, radius: 12, opacity: 0.14 },
      ],
    },
  };
}

export const THEME_DECOR: Partial<Record<ThemeId, Decor>> = {
  matrix: matrix(themes.matrix.colors),
  synthwave: synthwave(themes.synthwave.colors),
  seventies: seventies(themes.seventies.colors),
  newsprint: newsprint(themes.newsprint.colors),
  oxblood: oxblood(themes.oxblood.colors),
};
