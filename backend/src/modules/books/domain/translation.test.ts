import assert from "node:assert/strict";
import { test } from "node:test";
import { authorPattern, evidenceOf, isPortuguese, mainTitle, mentionsSurname, originalTitleIn, sameMainTitle, surnameOf, titlePattern } from "./translation.js";

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

test("Portuguese means a pt language tag", () => {
  assert.deepEqual(["pt", "pt-PT", "pt-BR", "en", null, "ptx"].map(isPortuguese), [true, true, true, false, false, false]);
});

test("title and author patterns match the catalog's title keys", () => {
  assert.equal(titlePattern("To the Lighthouse — A Novel"), "ta:to the lighthouse|*|");
  assert.equal(titlePattern("1984"), "ta:1984|*|1984");
  assert.equal(titlePattern("   "), null);
  assert.equal(authorPattern("Virginia Woolf, Ana Lima"), "ta:*|virginia woolf|*");
  assert.equal(authorPattern(""), null);
});

test("the surname is the last word of three or more letters, matched whole", () => {
  assert.equal(surnameOf("Fiódor Dostoiévski"), "dostoievski");
  assert.equal(surnameOf("José Saramago, Ana Lima"), "saramago");
  assert.equal(surnameOf("Li Bo"), null);
  assert.equal(mentionsSurname(["Um romance de Virginia Woolf."], "woolf"), true);
  assert.equal(mentionsSurname(["Woolfgang"], "woolf"), false);
  assert.equal(mentionsSurname([null, "Sem autor."], "woolf"), false);
});

test("evidence takes each field from the oldest edition that has it, and reads original titles from summaries", () => {
  const evidence = evidenceOf({
    workId: "w",
    workAuthor: "Robert Walser",
    editions: [
      { title: "O Passeio", author: "", publisher: null, summary: "Um passeio.\n\nTítulo original: Der Spaziergang", originalTitle: null },
      { title: "O Passeio (2.ª ed.)", author: "Robert Walser", publisher: "Relógio d'Água", summary: "Outra sinopse.", originalTitle: null }
    ]
  });
  assert.deepEqual(evidence, { workId: "w", title: "O Passeio", author: "Robert Walser", workAuthor: "Robert Walser", publisher: "Relógio d'Água", summary: "Um passeio.\n\nTítulo original: Der Spaziergang", originalTitle: "Der Spaziergang", summaries: ["Um passeio.\n\nTítulo original: Der Spaziergang", "Outra sinopse."] });
});
