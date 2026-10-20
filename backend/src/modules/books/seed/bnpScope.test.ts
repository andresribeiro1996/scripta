import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { mapBnpRecord, readMarcRecords } from "./bnpRecord.js";
import type { BnpBook } from "./bnpRecord.js";
import { bnpSkipReason, udcGenres } from "./bnpScope.js";

const book = (over: Partial<BnpBook>): BnpBook => ({ recordId: "1", isbns: ["9789720044457"], title: "T", author: "A B", translator: null, originalTitle: null, publisher: "Porto Editora", year: 2020, pages: 100, languages: ["por"], udc: [], summary: null, scanUrl: null, collection: null, ...over });

test("each rule skips its record, in order", () => {
  assert.equal(bnpSkipReason(book({ isbns: [] })), "noIsbn");
  assert.equal(bnpSkipReason(book({ udc: ["51(075.2)"] })), "textbook");
  assert.equal(bnpSkipReason(book({ publisher: null })), "noPublisher");
  assert.equal(bnpSkipReason(book({ publisher: "Câmara Municipal de Tavira" })), "institutional");
  assert.equal(bnpSkipReason(book({ author: "" })), "noPerson");
  assert.equal(bnpSkipReason(book({})), null);
  assert.equal(bnpSkipReason(book({ isbns: [], publisher: null })), "noIsbn");
  assert.equal(bnpSkipReason(book({ udc: ["51(075.2)"], publisher: null })), "textbook");
  assert.equal(bnpSkipReason(book({ publisher: "Câmara Municipal de Tavira", author: "" })), "institutional");
});

test("trade publishers a naive pattern would catch are kept", () => {
  for (const publisher of ["Clube do Autor", "Fundação Francisco Manuel dos Santos", "Fundação Calouste Gulbenkian", "Instituto Piaget", "Assírio & Alvim", "Edições Afrontamento"]) assert.equal(bnpSkipReason(book({ publisher })), null, publisher);
});

test("institutional publishers are dropped", () => {
  for (const publisher of ["Imprensa da Universidade de Coimbra", "Município de Oeiras", "União das Freguesias de Carcavelos e Parede", "Direcção-Geral de Inovação e Desenvolvimento Curricular", "Banda Musical das Caldas das Taipas", "Instituto Politécnico de Leiria"]) assert.equal(bnpSkipReason(book({ publisher })), "institutional", publisher);
});

test("udc codes map to genres and a plain novel gets none", () => {
  assert.deepEqual(udcGenres(['821.134.2(83)-31"19/20"']), []);
  assert.deepEqual(udcGenres(['821.134.3-1"20"']), ["Poetry"]);
  assert.deepEqual(udcGenres(['821.134.3-93"20"']), ["Children's"]);
  assert.deepEqual(udcGenres(['821.111-312.4"20"']), ["Crime"]);
  assert.deepEqual(udcGenres(["321.01", "1A/Z(091)"]), ["Politics", "Philosophy"]);
  assert.deepEqual(udcGenres(["159.942-053.2"]), ["Psychology"]);
  assert.deepEqual(udcGenres(["793.7(0.053.4/.5)"]), ["Children's"]);
  assert.deepEqual(udcGenres(["641.5"]), ["Cooking"]);
});

test("literary forms, exactly and not by a longer number", () => {
  assert.deepEqual(udcGenres(['821.134.3-13"20"']), []);
  assert.deepEqual(udcGenres(['821.134.3-1.09"20"']), []);
  assert.deepEqual(udcGenres(["821.134.3-1Pessoa, Fernando.09(042)"]), []);
  assert.deepEqual(udcGenres(["821.111-312.4Fleming, Ian.09"]), []);
  assert.deepEqual(udcGenres(['821.111(73)-311.6"18".09']), []);
  assert.deepEqual(udcGenres(["821.134.3-1Pessoa, Fernando(042)"]), ["Poetry"]);
  assert.deepEqual(udcGenres(['821.111(73)-311.9"19/20"']), ["Science Fiction"]);
  assert.deepEqual(udcGenres(['821.111-312.9"19/20"']), ["Fantasy"]);
  assert.deepEqual(udcGenres(['821.134.3-311.6"20"']), ["Historical Fiction"]);
  assert.deepEqual(udcGenres(['821.134.3-94"20"']), ["Biography & Memoir"]);
  assert.deepEqual(udcGenres(['821.134.3-992"19"']), ["Travel"]);
  assert.deepEqual(udcGenres(['821.134.3-993"20"']), []);
  assert.deepEqual(udcGenres(['821.134.3-311.6"18"']), ["Historical Fiction"]);
});

test("a subject treated as a character in fiction gives its code no genre", () => {
  assert.deepEqual(udcGenres(["821.133.1(569.3)-31", "929Leão, O Africano(0:82-31)"]), []);
  assert.deepEqual(udcGenres(['94(469)"18"(0:82-31)']), []);
  assert.deepEqual(udcGenres(['821.134.3-311.6"19"', '94(469)"18"(0:82-311.6)']), ["Historical Fiction"]);
});

test("age auxiliaries give children's or young adult, a person auxiliary does not", () => {
  assert.deepEqual(udcGenres(["51(0.053.4)"]), ["Science", "Children's"]);
  assert.deepEqual(udcGenres(["37.03(0.053.2)"]), ["Children's"]);
  assert.deepEqual(udcGenres(["159.922(0.053.6)"]), ["Psychology", "Young Adult"]);
  assert.deepEqual(udcGenres(["159.963-053.3(035)"]), ["Psychology"]);
  assert.deepEqual(udcGenres(["908(862)(0.053.5)"]), ["Children's"]);
  assert.deepEqual(udcGenres(['821.134.3-93"20"', "398.2(0.053.5)"]), ["Children's"]);
});

test("main numbers map by their longest prefix and the carved-out branches map to nothing", () => {
  assert.deepEqual(udcGenres(["159.923"]), ["Psychology"]);
  assert.deepEqual(udcGenres(["17"]), ["Philosophy"]);
  assert.deepEqual(udcGenres(["133.5"]), []);
  assert.deepEqual(udcGenres(["929Pessoa, Fernando"]), ["Biography & Memoir"]);
  assert.deepEqual(udcGenres(["929.52"]), []);
  assert.deepEqual(udcGenres(["910.4(540)"]), ["Travel"]);
  assert.deepEqual(udcGenres(["911.3"]), []);
  assert.deepEqual(udcGenres(["658.1"]), ["Business"]);
  assert.deepEqual(udcGenres(["656.7"]), []);
  assert.deepEqual(udcGenres(["741.5"]), []);
  assert.deepEqual(udcGenres(["004.8"]), ["Technology"]);
  assert.deepEqual(udcGenres(["272"]), ["Religion"]);
  assert.deepEqual(udcGenres(["94(469)\"15\""]), ["History"]);
  assert.deepEqual(udcGenres(["336.22"]), ["Business"]);
  assert.deepEqual(udcGenres(["629.33"]), ["Technology"]);
  assert.deepEqual(udcGenres(["582.26/.27(469.111)", "591.5(469.111)"]), ["Science"]);
  assert.deepEqual(udcGenres(["(075.2)", "A/Z", ""]), []);
});

test("the recorded national bibliography records scope and map as expected", () => {
  const oaiPage = readFileSync(new URL("./fixtures/bnp/oai-page.xml", import.meta.url), "utf8");
  const urn = readFileSync(new URL("./fixtures/bnp/urn-9789720044457.xml", import.meta.url), "utf8");
  const mapped = (xml: string, id?: string) => {
    const records = readMarcRecords(xml);
    return mapBnpRecord(id ? records.find((record) => record.id?.endsWith(`/${id}`))! : records[0]!);
  };
  const algas = mapped(oaiPage, "2047928");
  assert.equal(bnpSkipReason(algas), "institutional");
  assert.deepEqual(udcGenres(algas.udc), ["Science"]);
  const arendt = mapped(oaiPage, "1704776");
  assert.equal(bnpSkipReason(arendt), null);
  assert.deepEqual(udcGenres(arendt.udc), ["Politics", "Philosophy"]);
  const capital = mapped(oaiPage, "1233005");
  assert.equal(bnpSkipReason(capital), null);
  assert.deepEqual(udcGenres(capital.udc), []);
  const allende = mapped(urn);
  assert.equal(bnpSkipReason(allende), null);
  assert.deepEqual(udcGenres(allende.udc), []);
});
