import assert from "node:assert/strict";
import { test } from "node:test";
import { roundLabel } from "../arena/arenaBracket.js";
import { toSeedBook } from "../arena/arenaSeed.js";
import { countdownLabel } from "../arena/countdown.js";
import { authFieldErrors, passwordHint, recoveryMessage } from "../auth.js";
import { itemNoun } from "../characters/index.js";
import { playerLabel, quizClueHeading } from "../quizzes/labels.js";
import { fontLabel } from "../themes/fonts.js";
import { themeLabel } from "../themes/palettes.js";
import { aggregationModes } from "../tierlists/results.js";

test("themes and fonts are named in the reader's language", () => {
  assert.equal(themeLabel("dark", "en"), "Dark");
  assert.equal(themeLabel("dark", "pt-PT"), "Escuro");
  assert.equal(fontLabel("system", "pt-PT"), "Sistema");
  assert.equal(fontLabel("playfair", "pt-PT"), "Playfair");
});

test("auth text follows the language", () => {
  assert.equal(passwordHint("en"), "Use at least 8 characters. A longer passphrase is better.");
  assert.match(passwordHint("pt-PT"), /^Utilize pelo menos 8 caracteres/);
  assert.match(recoveryMessage("pt-PT"), /^Se existir uma conta/);
  assert.equal(authFieldErrors("login", "", "", "", "pt-PT").identifier, "Introduza o seu email ou nome de utilizador.");
  assert.equal(authFieldErrors("signup", "a@b.pt", "x", "pw", "pt-PT").password, "Utilize entre 8 e 128 caracteres.");
});

test("arena text follows the language", () => {
  assert.equal(roundLabel(1, 3, "pt-PT"), "Final");
  assert.equal(roundLabel(2, 2, "pt-PT"), "Meias-finais");
  assert.equal(roundLabel(4, 1, "pt-PT"), "Quartos de final");
  assert.equal(roundLabel(8, 1, "pt-PT"), "Ronda 1");
  const now = Date.parse("2026-01-01T00:00:00.000Z");
  assert.equal(countdownLabel("2025-12-31T00:00:00.000Z", "pt-PT", now), "A fechar…");
  assert.equal(countdownLabel("2026-01-04T04:00:00.000Z", "pt-PT", now), "faltam 3 d 4 h");
  assert.equal(countdownLabel("2026-01-04T04:00:00.000Z", "en", now), "3d 4h left");
  assert.equal(toSeedBook({ _workId: "w" }, null, "pt-PT")?.title, "Sem título");
});

test("quiz and tier list text follows the language", () => {
  assert.equal(playerLabel({ playerName: null, anonymous: true }, "pt-PT").name, "Convidado");
  assert.equal(quizClueHeading("title_cover", "pt-PT"), "Que capa pertence a este título?");
  assert.deepEqual(aggregationModes("pt-PT").map((item) => item.label), ["Média", "Mais votado", "Mediana"]);
  assert.equal(itemNoun(undefined, 1, "pt-PT"), "livro");
  assert.equal(itemNoun({}, 2, "pt-PT"), "personagens");
});
