import assert from "node:assert/strict";
import { test } from "node:test";
import { hasMojibake, repairMojibake, stripNonSortingMarkers } from "./mojibake.js";

const asWindows1252 = (text: string) => new TextDecoder("windows-1252").decode(new TextEncoder().encode(text));
const asLatin1 = (text: string) => Buffer.from(text, "utf8").toString("latin1");

test("repairs UTF-8 that was read as Windows-1252", () => {
  for (const text of ["Café com Açúcar", "Viagem à Lua — “Edição” de Júlio’s", "Stanisław Lem", "日本語の本", "Um paraíso", "Voilà"]) {
    assert.equal(repairMojibake(asWindows1252(text)), text);
  }
});

test("repairs a mis-decoded lowercase letter that follows a capital", () => {
  for (const text of ["Arturo Pérez-Reverte", "Idade Média", "Sérgio Martel", "Técnica fiscal", "Sûr", "Pé de Meia", "A Fé", "Zé Povinho", "Sé de Braga", "Dîner", "I’m Here"]) {
    assert.equal(repairMojibake(asWindows1252(text)), text);
  }
});

test("repairs UTF-8 that was read as Latin-1, with C1 controls", () => {
  assert.equal(repairMojibake(asLatin1("Coração — “Edição”")), "Coração — “Edição”");
});

test("repairs text that was mis-decoded twice", () => {
  assert.equal(repairMojibake(asWindows1252(asWindows1252("Coração"))), "Coração");
  assert.equal(repairMojibake(asLatin1(asLatin1("Coração"))), "Coração");
});

test("leaves correct text alone", () => {
  for (const text of ["Coração", "SÃO PAULO", "CANAÃ AO OESTE", "O ESPIÃO DE DEUS", "Ângela", "1º Volume", "© 2010", "naïve café", "ÉTÉ", "Åsa Larsson", "Stanisław Lem", ""]) {
    assert.equal(repairMojibake(text), text);
  }
});

test("leaves an accented capital before word-final punctuation alone", () => {
  for (const text of ["NESCAFÉ® Receitas", "CAFÉ’S", "CAFÉ’s", "JOSÉ’s house", "IRMÃ…", "A IRMÃ…", "Zu Fuß…", "irmã…»", "JOSÉ\xa0de Alencar", "Groß\xa0und klein", "CAFÉ\xa0noir", "MANHÃ\xa0cedo", "NESCAFÉ®receitas", "A IRMÃ»"]) {
    assert.equal(repairMojibake(text), text);
  }
});

test("leaves a lowercase letter that follows a capital before word-final punctuation alone", () => {
  for (const text of ["A Fé\xa0– Poemas", "Já\xa0– Poemas", "Ilha da Sé\xa0— Guia", "DER GROß\xa0UND KLEIN"]) {
    assert.equal(repairMojibake(text), text);
  }
});

test("stops after one repair when the result is correct text", () => {
  assert.equal(repairMojibake(asWindows1252("NESCAFÉ®receitas")), "NESCAFÉ®receitas");
});

test("leaves text it cannot repair whole", () => {
  assert.equal(repairMojibake("P©ssaro Azul"), "P©ssaro Azul");
  assert.equal(repairMojibake("fÃ© 日本"), "fÃ© 日本");
  assert.equal(repairMojibake("fÃ© \u{1F600}"), "fÃ© \u{1F600}");
});

test("hasMojibake flags text that still looks mis-decoded", () => {
  assert.equal(hasMojibake("Entre a fÃ© e a crenÃ§a"), true);
  assert.equal(hasMojibake("P©ssaro Azul"), true);
  assert.equal(hasMojibake("Caf�"), true);
  for (const text of ["Entre a fé e a crença", "IRMÃ…", "© 2010", "SÃO PAULO"]) assert.equal(hasMojibake(text), false);
});

test("stripNonSortingMarkers drops MARC non-sorting markers and keeps the text they wrap", () => {
  assert.equal(stripNonSortingMarkers("\u0098O \u009cNatal de Teste"), "O Natal de Teste");
  assert.equal(stripNonSortingMarkers("\u0098A \u009clíngua de teste"), "A língua de teste");
  assert.equal(stripNonSortingMarkers("3\u0098ª\u009c classe"), "3ª classe");
  assert.equal(stripNonSortingMarkers("Ana Co\u0098sta"), "Ana Costa");
  assert.equal(stripNonSortingMarkers("Coração"), "Coração");
});

test("stripNonSortingMarkers keeps the bytes of text mis-decoded as Latin-1", () => {
  for (const text of ["Über Teste", "Øre Teste", "“Edição”", "‘Teste’"]) {
    assert.equal(stripNonSortingMarkers(asLatin1(text)), asLatin1(text));
    assert.equal(repairMojibake(stripNonSortingMarkers(asLatin1(text))), text);
  }
  assert.equal(repairMojibake(stripNonSortingMarkers(`\u0098O \u009c${asLatin1("Øre Teste")}`)), "O Øre Teste");
});

test("text with markers and mojibake is repaired once the markers are gone", () => {
  assert.equal(repairMojibake("\u0098A \u009cfÃ© e a crenÃ§a"), "\u0098A \u009cfÃ© e a crenÃ§a");
  assert.equal(repairMojibake(stripNonSortingMarkers("\u0098A \u009cfÃ© e a crenÃ§a")), "A fé e a crença");
});
