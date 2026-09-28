import { THEME_IDS, themes, type ThemeColors } from "@scripta/shared/themes";

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

export function renderThemesCss(): string {
  const darkSelectors = THEME_IDS.filter((id) => themes[id].scheme === "dark")
    .map((id) => `[data-theme="${id}"], [data-theme="${id}"] *`)
    .join(", ");
  const blocks = THEME_IDS.map((id) => `:root[data-theme="${id}"] {\n  color-scheme: ${themes[id].scheme};\n${declarations(themes[id].colors)}\n}\n`);
  return [
    "/* Generated from @scripta/shared/themes by `npm run themes --workspace frontend`. Do not edit. */\n",
    `@custom-variant dark (&:where(${darkSelectors}));\n`,
    `@theme {\n${declarations(themes.light.colors)}\n}\n`,
    ":root {\n  color-scheme: light;\n}\n",
    ...blocks,
  ].join("\n");
}
