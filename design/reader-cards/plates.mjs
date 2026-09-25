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

let uidCount = 0;
const uid = (prefix) => `${prefix}-${++uidCount}`;

const fourPointStar = (x, y, r = 4) => `M${x} ${y - r}L${x + r / 4} ${y - r / 4}L${x + r} ${y}L${x + r / 4} ${y + r / 4}L${x} ${y + r}L${x - r / 4} ${y + r / 4}L${x - r} ${y}L${x - r / 4} ${y - r / 4}Z`;

export const emblems = {
  carto: () => {
    const graticule = [
      `<ellipse class="pl" cx="125" cy="134" rx="55" ry="20" stroke-width=".5"/>`,
      `<ellipse class="pl" cx="125" cy="134" rx="55" ry="40" stroke-width=".5"/>`,
      `<ellipse class="pl" cx="125" cy="134" rx="20" ry="55" stroke-width=".5"/>`,
      `<ellipse class="pl" cx="125" cy="134" rx="40" ry="55" stroke-width=".5"/>`,
      `<path class="pl" d="M70 134H180M125 79V189" stroke-width=".5"/>`,
    ];
    const s = 21.2;
    const shorts = [
      `M125 134L125 127L${125 + s} ${134 - s}L132 134Z`,
      `M125 134L132 134L${125 + s} ${134 + s}L125 141Z`,
      `M125 134L125 141L${125 - s} ${134 + s}L118 134Z`,
      `M125 134L118 134L${125 - s} ${134 - s}L125 127Z`,
    ].map((d) => `<path class="pgl" d="${d}" stroke-width="1" stroke-linejoin="round"/>`);
    const a = 120.05, b = 129.95, u = 129.05, v = 138.95;
    const longs = [
      [`M125 134L125 84L${a} ${u}Z`, `M125 134L125 84L${b} ${u}Z`],
      [`M125 134L175 134L${b} ${u}Z`, `M125 134L175 134L${b} ${v}Z`],
      [`M125 134L125 184L${b} ${v}Z`, `M125 134L125 184L${a} ${v}Z`],
      [`M125 134L75 134L${a} ${v}Z`, `M125 134L75 134L${a} ${u}Z`],
    ].map(([fill, open]) => `<path class="pf" d="${fill}"/><path class="pgl" d="${open}" stroke-width="1" stroke-linejoin="round"/>`);
    return [...graticule, ...shorts, ...longs, `<circle class="pgl" cx="125" cy="134" r="5" stroke-width="1"/><circle class="pf" cx="125" cy="134" r="2"/>`].join("");
  },
  anno: () => [
    `<path class="pgl" d="M76 152Q100 143 125 151L125 178Q100 170 76 179Z" stroke-width="1.3" stroke-linejoin="round"/>`,
    `<path class="pgl" d="M125 151Q150 143 174 152L174 179Q150 170 125 178Z" stroke-width="1.3" stroke-linejoin="round"/>`,
    `<path class="pl" d="M84 158Q101 152 118 157M84 164Q101 158 118 163M84 170Q101 164 118 169M134 157Q150 152 166 158M134 169Q150 164 166 170" stroke-width=".6"/>`,
    `<path class="pl" d="M134 163.2Q150 158 166 164" stroke-width="2.4" stroke-linecap="round"/>`,
    `<path class="pl" d="M131 154.5h-2.6v19h2.6" stroke-width="1.2"/>`,
    `<path class="pf" d="M141 142Q98 130 92 86Q128 104 141 142Z"/>`,
    `<path class="pgs" d="M131 131L117 133M124 120L108 121M117 109L101 108M109 98L96 96M134 126L137 112M126 114L128 100M118 103L119 92" stroke-width=".9" stroke-linecap="round"/>`,
    `<path class="pl" d="M149 153L90 83" stroke-width="1.3" stroke-linecap="round"/>`,
    `<path class="pf" d="M145.5 148.5L151.5 157.5L149 150.5Z"/>`,
  ].join(""),
  lamp: () => {
    const rays = [0, 180, -20, -160, 20, 160, -45, -135].map((deg) => {
      const t = (deg * Math.PI) / 180;
      const p = (r) => [125 + r * Math.cos(t), 126 + r * Math.sin(t)].map((n) => n.toFixed(1)).join(" ");
      return `M${p(29)}L${p(39)}`;
    }).join("");
    return [
      `<path class="pl" d="${rays}" stroke-width=".9" stroke-linecap="round"/>`,
      `<circle class="pl" cx="125" cy="84" r="6" stroke-width="1.4"/>`,
      `<path class="pf" d="M109 101L141 101L134 90L116 90Z"/>`,
      `<rect class="pgl" x="107" y="101" width="36" height="50" stroke-width="1.4"/>`,
      `<path class="pl" d="M113 101V151M137 101V151" stroke-width=".7"/>`,
      `<path class="pf" d="M125 110C133 121 134 131 125 140C116 131 117 121 125 110Z"/>`,
      `<path class="pgf" d="M125 123C128 128 128 132 125 136C122 132 122 128 125 123Z"/>`,
      `<path class="pf" d="M105 151L145 151L141 159L109 159Z"/>`,
      `<path class="pl" d="M113 159V164H137V159" stroke-width="1.2"/>`,
      `<path class="pf" d="${fourPointStar(152, 92)}${fourPointStar(98, 176)}"/>`,
    ].join("");
  },
  star: () => {
    const id = uid("cres");
    const cres = "M121.96 90.19A40 40 0 1 0 152.22 150.71A34 34 0 1 1 121.96 90.19Z";
    let hatch = "";
    for (let k = 166; k <= 332; k += 3.1) hatch += `M${(k - 174).toFixed(1)} 174L${(k - 86).toFixed(1)} 86`;
    return [
      `<clipPath id="${id}"><path d="${cres}"/></clipPath>`,
      `<g clip-path="url(#${id})"><path class="pl" d="${hatch}" stroke-width=".55"/></g>`,
      `<path class="pl" d="${cres}" stroke-width="1.4" stroke-linejoin="round"/>`,
      `<g transform="rotate(-18 147 106)"><path class="pl" d="M133 106A14 3.8 0 0 1 161 106" stroke-width="1"/></g>`,
      `<circle class="pf" cx="147" cy="106" r="7"/>`,
      `<g transform="rotate(-18 147 106)"><path class="pgs" d="M133 106A14 3.8 0 0 0 161 106" stroke-width="2.8"/><path class="pl" d="M133 106A14 3.8 0 0 0 161 106" stroke-width="1"/></g>`,
      `<path class="pf" d="${fourPointStar(166, 128)}${fourPointStar(157, 153, 3.2)}"/>`,
      `<circle class="pf" cx="139" cy="85" r="1.2"/><circle class="pf" cx="171" cy="146" r="1.1"/>`,
    ].join("");
  },
  arch: () => {
    let caps = "";
    for (let x = 102; x <= 148; x += 3) caps += `M${x} 86.5V90.5M${x} 173.5V177.5`;
    return [
      `<rect class="pgl" x="99" y="85" width="52" height="7" rx="1.5" stroke-width="1.3"/>`,
      `<rect class="pgl" x="99" y="172" width="52" height="7" rx="1.5" stroke-width="1.3"/>`,
      `<path class="pl" d="${caps}" stroke-width=".5"/>`,
      `<path class="pl" d="M104 92V172M146 92V172" stroke-width="1.3"/>`,
      `<circle class="pf" cx="104" cy="132" r="2.4"/><circle class="pf" cx="146" cy="132" r="2.4"/>`,
      `<path class="pgl" d="M110 92C110 114 120 124 123 132C120 140 110 150 110 172H140C140 150 130 140 127 132C130 124 140 114 140 92Z" stroke-width="1.3" stroke-linejoin="round"/>`,
      `<path class="pf" d="M113.5 106C116 117 121 125 124 130H126C129 125 134 117 136.5 106Z"/>`,
      `<path class="pl" d="M125 130V160" stroke-width=".8" stroke-dasharray="1.5 1.5"/>`,
      `<path class="pf" d="M112 172C114 163 119 158 125 157C131 158 136 163 138 172Z"/>`,
      `<path class="pl" d="M114.5 96C114.5 104 116 110 118.5 115M114.5 168C114.5 160 116 154 118.5 149" stroke-width=".6" stroke-linecap="round"/>`,
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
      `<path class="pgl" d="${leaf}" stroke-width=".9" transform="translate(${x} ${y}) rotate(-52)"/>`,
      `<path class="pgl" d="${leaf}" stroke-width=".9" transform="translate(${250 - x} ${y}) rotate(52)"/>`,
      `<path class="pgl" d="${leaf}" stroke-width=".9" transform="translate(${x} ${y}) rotate(-128) scale(.8)"/>`,
      `<path class="pgl" d="${leaf}" stroke-width=".9" transform="translate(${250 - x} ${y}) rotate(128) scale(.8)"/>`,
    ]).join("");
    return [
      `<path class="pl" d="M92 101Q125 84 158 101" stroke-width="1"/>`,
      leaves,
      `<rect class="pgl" x="82" y="110" width="86" height="54" rx="1.5" stroke-width="1.4"/>`,
      `<path class="pl" d="${flap}" stroke-width=".55"/>`,
      `<path class="pl" d="M82 164L115 137M168 164L135 137" stroke-width=".6"/>`,
      `<path class="pl" d="M82 110L125 142L168 110" stroke-width="1.2" stroke-linejoin="round"/>`,
      `<circle class="pf" cx="125" cy="142" r="11"/><path class="pf" d="M117.5 149.5Q116 156 119.5 157Q121.5 153 120.5 150ZM132 150.5Q134 155 131.5 156.5Q129.5 154 129.8 151.5Z"/>`,
      `<circle class="pgs" cx="125" cy="142" r="7.6" stroke-width=".8"/><path class="pgf" d="M125 137.6L128.4 142L125 146.4L121.6 142Z"/>`,
    ].join("");
  },
  way: () => {
    const jib = [[100, 131.5], [104, 123.5], [108, 116], [112, 109.5], [116, 103.5], [120, 97.5]].map(([x, y]) => `M${x} ${y + 1.8}V142.5`).join("");
    return [
      `<path class="pl" d="M125 83V149" stroke-width="1.4"/>`,
      `<path class="pf" d="M125 83L139 86.5L125 90Z"/>`,
      `<path class="pgl" d="M127 90L127 144L160 144Q151 114 127 90Z" stroke-width="1.3" stroke-linejoin="round"/>`,
      `<path class="pl" d="M127 109H142.5M127 125H151.5" stroke-width=".6"/>`,
      `<path class="pgl" d="M123 94L123 144L94 144Q104 118 123 94Z" stroke-width="1.3" stroke-linejoin="round"/>`,
      `<path class="pl" d="${jib}" stroke-width=".55"/>`,
      `<path class="pf" d="M86 148H164L153 163H97Z"/>`,
      `<path class="pgs" d="M93 152.5H157" stroke-width=".9"/>`,
      `<path class="pl" d="M84 170q8-5 16 0t16 0t16 0t16 0t16 0" stroke-width="1.1"/>`,
      `<path class="pl" d="M96 177q7-4 14 0t14 0t14 0t14 0" stroke-width=".6"/>`,
    ].join("");
  },
  loyal: () => {
    const up = uid("wing"), down = uid("wing");
    const wingUp = "M-18-5Q-12-30 12-44Q2-24-2-4Z";
    const wingDown = "M-18 5Q-12 30 12 44Q2 24-2 4Z";
    let lines = "";
    for (let x = -18; x <= 13; x += 2.8) lines += `M${x.toFixed(1)}-46V46`;
    return [
      `<path class="pl" d="M164.3 161.5A48 48 0 0 1 85.7 161.5" stroke-width=".9" stroke-dasharray="1.4 3.2" stroke-linecap="round"/>`,
      `<path class="pl" d="M86.1 166.5L85.7 161.5L90.2 163.6" stroke-width=".9" stroke-linecap="round" stroke-linejoin="round"/>`,
      `<g transform="translate(125 131) rotate(-22)">`,
      `<clipPath id="${up}"><path d="${wingUp}"/></clipPath><clipPath id="${down}"><path d="${wingDown}"/></clipPath>`,
      `<path class="pgl" d="${wingUp}" stroke-width="1.3" stroke-linejoin="round"/><g clip-path="url(#${up})"><path class="pl" d="${lines}" stroke-width=".55"/></g>`,
      `<path class="pgl" d="${wingDown}" stroke-width="1.3" stroke-linejoin="round"/><g clip-path="url(#${down})"><path class="pl" d="${lines}" stroke-width=".55"/></g>`,
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
