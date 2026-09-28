import { writeFileSync } from "node:fs";
import { renderThemesCss } from "./themesCss.mts";

writeFileSync(new URL("../src/themes.css", import.meta.url), renderThemesCss());
