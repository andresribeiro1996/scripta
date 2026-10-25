import assert from "node:assert/strict";
import test from "node:test";
import { isOmnibusTitle, joinVerdict, volumeNumber } from "./volumeGuard.js";

const none = () => null;
const kinds = (map: Record<string, "series" | "collection">) => (title: string) => map[title] ?? null;
const noSeries: Array<{ nameKey: string; position: string | null }> = [];
type Kind = (title: string) => "series" | "collection" | null;

const cases: Array<[string, string, string, Kind, string, Array<{ nameKey: string; position: string | null }>?]> = [
  ["numbered volume into whole work", "Os Miseráveis I", "Les Misérables", none, "never"],
  ["roman volume into whole work", "O Conde de Monte Cristo II", "The Count of Monte Cristo", none, "never"],
  ["same volume", "Os Miseráveis I", "Les Misérables I", none, "join"],
  ["roman in name", "Henrique V", "Henry V", none, "join"],
  ["number in name", "Catch-22", "Catch-22", none, "join"],
  ["X in name", "Malcolm X", "The Autobiography of Malcolm X", none, "join"],
  ["trailing X is a letter", "Raio-X", "X-Ray", none, "join"],
  ["three digits", "Fahrenheit 451", "Fahrenheit 451", none, "join"],
  ["subtitle volume", "A Coisa - Livro 1", "It", none, "review"],
  ["series subtitle volume", "A Irmandade do Anel - O Senhor dos Anéis - Parte I", "The Fellowship of the Ring", none, "review"],
  ["target heads series", "A Irmandade do Anel", "The Lord of the Rings", kinds({ "The Lord of the Rings": "series" }), "review", noSeries],
  ["second book of the series head", "A Irmandade do Anel", "The Lord of the Rings", kinds({ "The Lord of the Rings": "series" }), "review", [{ nameKey: "the lord of the rings", position: "2" }]],
  ["series head target without the series row", "As duas Torres", "The Lord of the Rings", kinds({ "The Lord of the Rings": "series" }), "review", noSeries],
  ["same title heads series", "Duna", "Dune", kinds({ Dune: "series" }), "review", noSeries],
  ["series named after its first book", "Duna", "Dune", kinds({ Dune: "series" }), "join", [{ nameKey: "dune", position: "1" }]],
  ["omnibus target", "Anúncio de um crime", "Murder on the Orient Express / A Murder is Announced", none, "review"],
  ["both omnibus", "Trilogia Millennium", "The Millennium Trilogy", none, "join"],
  ["plain", "Passeio ao Farol", "To the Lighthouse", none, "join"],
  ["bracketed volume", "Os Miseráveis (Volume I)", "Les Misérables", none, "never"],
  ["bracketed series with book", "A Guerra dos Tronos (As Crónicas de Gelo e Fogo, Livro 1)", "A Game of Thrones", none, "join"],
  ["target name and part numbers", "Henrique IV - Parte I", "Henry IV, Part 1", none, "join"],
  ["target name and part numbers VI", "Henrique VI - Parte 3", "Henry VI, Part 3", none, "join"],
  ["numbered series book with subtitle", "Diário de um Banana 2 - A Vingança do Rodrick", "Rodrick Rules", none, "join"],
  ["numbered series book of a series head", "Geronimo Stilton 5", "Four Mice Deep in the Jungle", kinds({ "Geronimo Stilton": "series" }), "review"],
  ["bracketed series", "Harry Potter e a Pedra Filosofal (Harry Potter, #1)", "Harry Potter and the Philosopher's Stone", none, "join"],
  ["dotted volume then subtitle", "Empíreo.. Vol. 1,. Quarta asa", "Fourth Wing", none, "join"],
  ["hash number", "Os Jogos da Herança #1", "The Inheritance Games", none, "join"],
  ["Nº number", "O Sobrinho do Mágico Nº 1", "The Magician's Nephew", none, "join"],
  ["number in the title", "Uma rapariga dos anos 20", "Twenties Girl", none, "join"],
  ["dotted volume word", "Esses prazeres violentos.. Livro 1", "These Violent Delights", none, "review"],
  ["weak digit without series row", "A Seleção 1", "The Selection", none, "review", noSeries],
  ["weak digit with series row", "A Seleção 1", "The Selection", none, "join", [{ nameKey: "the selection", position: "1" }]],
  ["series position in the subtitle", "Casa de Chama e Sombra – Cidade da Lua Crescente 3", "House of Flame and Shadow", none, "join"],
  ["subtitle volume word", "Os Pilares da Terra - Volume I", "The Pillars of the Earth", none, "review"],
  ["roman volume of a lone work", "Memória do Fogo I", "Memory of fire", none, "never"],
  ["collection of the same name", "Poesia", "Poesia", kinds({ Poesia: "collection" }), "join"],
  ["volume of a collection", "Blacksad.. Vol. 1,. Algures entre as sombras", "Blacksad", kinds({ Blacksad: "collection" }), "review"],
  ["original title no longer counts", "História do Novo Nome", "The Story of a New Name", kinds({ "L'amica geniale": "series" }), "join"]
];

for (const [name, work, target, kind, expected, series] of cases) {
  test(`joinVerdict: ${name}`, () => assert.equal(joinVerdict({ title: work }, { title: target, series: series ?? noSeries }, kind), expected));
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
