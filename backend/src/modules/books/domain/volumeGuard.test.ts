import assert from "node:assert/strict";
import test from "node:test";
import { isOmnibusTitle, joinVerdict, volumeNumber } from "./volumeGuard.js";

const none = () => false;
const heads = (names: string[]) => (title: string) => names.includes(title);

const cases: Array<[string, { title: string; originalTitle: string | null }, { title: string }, (title: string) => boolean, string]> = [
  ["numbered volume into whole work", { title: "Os Miseráveis I", originalTitle: "Les Misérables" }, { title: "Les Misérables" }, none, "never"],
  ["roman volume into whole work", { title: "O Conde de Monte Cristo II", originalTitle: null }, { title: "The Count of Monte Cristo" }, none, "never"],
  ["same volume", { title: "Os Miseráveis I", originalTitle: null }, { title: "Les Misérables I" }, none, "join"],
  ["roman in name", { title: "Henrique V", originalTitle: "Henry V" }, { title: "Henry V" }, none, "join"],
  ["number in name", { title: "Catch-22", originalTitle: "Catch-22" }, { title: "Catch-22" }, none, "join"],
  ["X in name", { title: "Malcolm X", originalTitle: null }, { title: "The Autobiography of Malcolm X" }, none, "join"],
  ["trailing X is a letter", { title: "Raio-X", originalTitle: "X-Ray" }, { title: "X-Ray" }, none, "join"],
  ["three digits", { title: "Fahrenheit 451", originalTitle: null }, { title: "Fahrenheit 451" }, none, "join"],
  ["subtitle volume", { title: "A Coisa - Livro 1", originalTitle: "It" }, { title: "It" }, none, "review"],
  ["series subtitle volume", { title: "A Irmandade do Anel - O Senhor dos Anéis - Parte I", originalTitle: null }, { title: "The Fellowship of the Ring" }, none, "review"],
  ["target heads series", { title: "A Irmandade do Anel", originalTitle: "The lord of the rings" }, { title: "The Lord of the Rings" }, heads(["The Lord of the Rings"]), "review"],
  ["original heads series", { title: "As duas Torres", originalTitle: "The lord of the rings-the two towers" }, { title: "The Lord of the Rings" }, heads(["The Lord of the Rings"]), "review"],
  ["same title heads series", { title: "Duna", originalTitle: "Dune" }, { title: "Dune" }, heads(["Dune"]), "review"],
  ["omnibus target", { title: "Anúncio de um crime", originalTitle: "A Murder is Announced" }, { title: "Murder on the Orient Express / A Murder is Announced" }, none, "review"],
  ["both omnibus", { title: "Trilogia Millennium", originalTitle: null }, { title: "The Millennium Trilogy" }, none, "join"],
  ["plain", { title: "Passeio ao Farol", originalTitle: "To the Lighthouse" }, { title: "To the Lighthouse" }, none, "join"],
  ["bracketed volume", { title: "Os Miseráveis (Volume I)", originalTitle: "Les Misérables" }, { title: "Les Misérables" }, none, "never"],
  ["bracketed series with book", { title: "A Guerra dos Tronos (As Crónicas de Gelo e Fogo, Livro 1)", originalTitle: "A Game of Thrones" }, { title: "A Game of Thrones" }, none, "join"],
  ["target name and part numbers", { title: "Henrique IV - Parte I", originalTitle: "Henry IV, Part 1" }, { title: "Henry IV, Part 1" }, none, "join"],
  ["target name and part numbers VI", { title: "Henrique VI - Parte 3", originalTitle: "Henry VI, Part 3" }, { title: "Henry VI, Part 3" }, none, "join"],
  ["numbered series book with subtitle", { title: "Diário de um Banana 2 - A Vingança do Rodrick", originalTitle: "Rodrick Rules" }, { title: "Rodrick Rules" }, none, "review"],
  ["numbered series book of a series head", { title: "Geronimo Stilton 5", originalTitle: null }, { title: "Four Mice Deep in the Jungle" }, heads(["Geronimo Stilton"]), "review"],
  ["bracketed series", { title: "Harry Potter e a Pedra Filosofal (Harry Potter, #1)", originalTitle: "Harry Potter and the Philosopher's Stone" }, { title: "Harry Potter and the Philosopher's Stone" }, none, "join"]
];

for (const [name, work, target, series, expected] of cases) {
  test(`joinVerdict: ${name}`, () => assert.equal(joinVerdict(work, target, series), expected));
}

test("volumeNumber", () => {
  assert.equal(volumeNumber("Harry Potter #3"), "3");
  assert.equal(volumeNumber("tomo dois"), "2");
  assert.equal(volumeNumber("1984"), null);
  assert.equal(volumeNumber("Henry"), null);
  assert.equal(volumeNumber("Geração X"), null);
});

test("isOmnibusTitle", () => {
  assert.equal(isOmnibusTitle("Harry Potter Boxset Books 1-7"), true);
  assert.equal(isOmnibusTitle("The Collector"), false);
  assert.equal(isOmnibusTitle("Recollections"), false);
});
