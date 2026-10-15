import assert from "node:assert/strict";
import { test } from "node:test";
import { mainTitle, originalTitleIn, sameMainTitle } from "./translation.js";

test("originalTitleIn reads the labelled value to the end of its line", () => {
  assert.equal(originalTitleIn("Uma sinopse.\n\nTítulo original: Les Misérables"), "Les Misérables");
  assert.equal(originalTitleIn("Titulo original - The Pure."), "The Pure");
  assert.equal(originalTitleIn("Tradução de Ana Lima. Título original Der Spaziergang\nOutra linha"), "Der Spaziergang");
  assert.equal(originalTitleIn("TÍTULO ORIGINAL — Ökendykarna;"), "Ökendykarna");
  assert.equal(originalTitleIn("Título original:   "), null);
  assert.equal(originalTitleIn(`Título original: ${"x".repeat(201)}`), null);
  assert.equal(originalTitleIn("Uma sinopse sem rótulo."), null);
  assert.equal(originalTitleIn(null), null);
});

test("the main title stops at the first dash or full-stop separator", () => {
  assert.equal(mainTitle("Lipstick Traces — A Secret History of the Twentieth Century"), "Lipstick Traces");
  assert.equal(mainTitle("Autobiographie d'un poulpe - et autres récits"), "Autobiographie d'un poulpe");
  assert.equal(mainTitle("Brave New World"), "Brave New World");
});

test("sameMainTitle compares main titles the catalog's way, numbers included", () => {
  assert.equal(sameMainTitle("To the Lighthouse — A Novel", "To the Lighthouse: A Novel"), true);
  assert.equal(sameMainTitle("Memorial do Convento", "Memorial do convento"), true);
  assert.equal(sameMainTitle("1984", "1985"), false);
  assert.equal(sameMainTitle("", ""), false);
});
