import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { INKS, PAPER, PLATES, REVERSED_LINE, glyph, plate, plateEpithet, plateName, printStyle } from "../../packages/shared/dist/readerCards/plates.js";

const here = dirname(fileURLToPath(import.meta.url));
const standalone = (svg, ground, line) => svg.replace(">", `>${printStyle(ground, line)}`);

for (const p of PLATES) {
  const [, ink, deep] = INKS[p.key];
  const base = `${p.numeral.toLowerCase()}-${p.key}`;
  const name = plateName(p.key, "en");
  const card = plate({ ...p, locale: "en", name, epithet: plateEpithet(p.key, "en"), label: `The ${name} reader card` });
  writeFileSync(join(here, `${base}-paper.svg`), standalone(card, PAPER, ink));
  writeFileSync(join(here, `${base}-reversed.svg`), standalone(card, deep, REVERSED_LINE));
  writeFileSync(join(here, `${base}-glyph.svg`), standalone(glyph(p.key, 48), PAPER, ink));
}
