import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { STYLE_FONT_FAMILIES } from "./fontStyle";
import { FONT_IDS, fontFileName, fonts } from "@scripta/shared/themes";

test("every bundled font weight is registered and its file exists", () => {
  const source = readFileSync("src/ui/fontAssets.ts", "utf8");
  for (const id of FONT_IDS) {
    for (const weight of fonts[id].weights) {
      const name = fontFileName(id, weight);
      assert.ok(source.includes(`"${name}": require("../../assets/fonts/${name}.ttf")`), name);
      assert.ok(existsSync(`assets/fonts/${name}.ttf`), `missing assets/fonts/${name}.ttf`);
    }
  }
});

test("card and mural fonts use registered native assets", () => {
  const source = readFileSync("src/ui/fontAssets.ts", "utf8");
  for (const name of Object.values(STYLE_FONT_FAMILIES)) {
    assert.ok(source.includes(`"${name}": require("../../assets/fonts/${name}.ttf")`), name);
    assert.ok(existsSync(`assets/fonts/${name}.ttf`), name);
  }
});
