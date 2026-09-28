import { DISPLAY_FONT_IDS, FONT_IDS, TEXT_FONT_IDS, THEME_DECOR, THEME_IDS, fontFileName, fontStack, fonts, themes, withOpacity, type DecorAnchor, type FontId, type ThemeColors } from "@scripta/shared/themes";

const WEB_TOKENS: Array<[keyof ThemeColors, string]> = [
  ["background", "--color-bg"],
  ["surface", "--color-surface"],
  ["surfacePressed", "--color-surface-hover"],
  ["text", "--color-text"],
  ["textDim", "--color-text-dim"],
  ["border", "--color-border"],
  ["accent", "--color-accent"],
  ["accentSoft", "--color-accent-soft"],
  ["onAccent", "--color-on-accent"],
  ["danger", "--color-danger"],
  ["dangerSoft", "--color-danger-soft"],
  ["success", "--color-success"],
  ["successSoft", "--color-success-soft"],
  ["info", "--color-info"],
  ["infoSoft", "--color-info-soft"],
  ["reference", "--color-reference"],
  ["referenceSoft", "--color-reference-soft"],
  ["onDanger", "--color-on-danger"],
];

function declarations(colors: ThemeColors): string {
  return WEB_TOKENS.map(([token, name]) => `  ${name}: ${colors[token]};`).join("\n");
}

function fontFaces(): string[] {
  return FONT_IDS.flatMap((id) => {
    const font = fonts[id];
    if (!font.family) return [];
    const coversAllWeights = font.weights.length === 1 && !font.slots.includes("text") && id !== "playfair";
    return font.weights.map((weight) =>
      [
        "@font-face {",
        `  font-family: "${font.family}";`,
        `  src: url("/fonts/${fontFileName(id, weight)}.woff2") format("woff2");`,
        `  font-weight: ${coversAllWeights ? "100 900" : weight};`,
        "  font-style: normal;",
        "  font-display: swap;",
        ...(font.scale === 1 ? [] : [`  size-adjust: ${Math.round(font.scale * 100)}%;`]),
        "}\n",
      ].join("\n"),
    );
  });
}

function fontVariables(display: FontId, text: FontId): string {
  return `  --font-display: ${fontStack(display)};\n  --font-text: ${fontStack(text)};`;
}

const POSITIONS: Record<DecorAnchor, string> = {
  "top-left": "left top",
  "top-right": "right top",
  "bottom-left": "left bottom",
  "bottom-right": "right bottom",
  top: "center top",
  bottom: "center bottom",
};

function decorRules(): string[] {
  return THEME_IDS.flatMap((id) => {
    const decor = THEME_DECOR[id];
    if (!decor) return [];
    const layers = decor.pieces.map((piece) => {
      const width = piece.width === "full" ? "100%" : `${piece.width}px`;
      return `url("data:image/svg+xml,${encodeURIComponent(piece.svg)}") ${POSITIONS[piece.anchor]} / ${width} ${piece.height}px no-repeat`;
    });
    const rules = [
      `:root[data-theme="${id}"] body::before {\n  content: "";\n  position: fixed;\n  inset: 0;\n  z-index: -1;\n  pointer-events: none;\n  background:\n    ${layers.join(",\n    ")};\n}\n`,
    ];
    if (decor.frame) {
      const [outer, inner] = decor.frame.lines;
      rules.push(
        `:root[data-theme="${id}"] body::after {\n  content: "";\n  position: fixed;\n  inset: ${outer!.inset}px;\n  z-index: -1;\n  pointer-events: none;\n  border: ${outer!.width}px solid ${withOpacity(decor.frame.color, outer!.opacity)};\n  border-radius: ${outer!.radius}px;\n  outline: ${inner!.width}px solid ${withOpacity(decor.frame.color, inner!.opacity)};\n  outline-offset: -${inner!.inset - outer!.inset}px;\n}\n`,
      );
    }
    return rules;
  });
}

export function renderThemesCss(): string {
  const darkSelectors = THEME_IDS.filter((id) => themes[id].scheme === "dark")
    .map((id) => `[data-theme="${id}"], [data-theme="${id}"] *`)
    .join(", ");
  const blocks = THEME_IDS.map(
    (id) => `:root[data-theme="${id}"] {\n  color-scheme: ${themes[id].scheme};\n${declarations(themes[id].colors)}\n${fontVariables(themes[id].fonts.display, themes[id].fonts.text)}\n}\n`,
  );
  const displayOverrides = DISPLAY_FONT_IDS.map((id) => `:root[data-font-display="${id}"] {\n  --font-display: ${fontStack(id)};\n}\n`);
  const textOverrides = TEXT_FONT_IDS.map((id) => `:root[data-font-text="${id}"] {\n  --font-text: ${fontStack(id)};\n}\n`);
  return [
    "/* Generated from @scripta/shared/themes by `npm run themes --workspace frontend`. Do not edit. */\n",
    `@custom-variant dark (&:where(${darkSelectors}));\n`,
    ...fontFaces(),
    `@theme {\n${declarations(themes.light.colors)}\n${fontVariables(themes.light.fonts.display, themes.light.fonts.text)}\n}\n`,
    ":root {\n  color-scheme: light;\n}\n",
    ...blocks,
    ...displayOverrides,
    ...textOverrides,
    ...decorRules(),
  ].join("\n");
}
