import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { mapBnpRecord, readMarcRecords, readOaiError, readResumptionToken } from "./bnpRecord.js";
import type { MarcField, MarcRecord } from "./bnpRecord.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/bnp/${name}`, import.meta.url), "utf8");
const oaiPage = fixture("oai-page.xml");
const oaiEmpty = fixture("oai-empty.xml");
const urnAllende = fixture("urn-9789720044457.xml");
const urnMissing = fixture("urn-missing.xml");

const byId = (id: string) => readMarcRecords(oaiPage).find((record) => record.id === `oai:oai.bn.pt:bibliografianacional/${id}`)!;

const field = (tag: string, ...subfields: Array<[string, string]>): MarcField => ({ tag, subfields });
const record = (fields: MarcField[], controls: Record<string, string> = {}): MarcRecord => ({ id: null, datestamp: null, deleted: false, controls, fields });
const book = (...fields: MarcField[]) => mapBnpRecord(record(fields));

test("an OAI page gives its records, header and resumption token", () => {
  const records = readMarcRecords(oaiPage);
  assert.ok(records.length >= 2);
  const arendt = records.find((r) => r.id === "oai:oai.bn.pt:bibliografianacional/1704776")!;
  assert.match(arendt.datestamp!, /^\d{4}-\d{2}-\d{2}/);
  assert.equal(arendt.deleted, false);
  assert.equal(readResumptionToken(oaiPage), "TOKEN-1");
});

test("an empty window, a noRecordsMatch error and a per-ISBN miss read as no records", () => {
  assert.deepEqual(readMarcRecords(oaiEmpty), []);
  assert.equal(readResumptionToken(oaiEmpty), null);
  const noMatch = `<OAI-PMH><error code="noRecordsMatch">none</error></OAI-PMH>`;
  assert.deepEqual(readMarcRecords(noMatch), []);
  assert.equal(readOaiError(noMatch), null);
  assert.equal(readOaiError(`<OAI-PMH><error code="badResumptionToken">x</error></OAI-PMH>`), "badResumptionToken");
  assert.deepEqual(readMarcRecords(urnMissing), []);
  assert.equal(readOaiError(urnMissing), null);
  assert.equal(readOaiError(oaiPage), null);
});

test("a deleted header reads as a deleted record with no fields", () => {
  const xml = `<OAI-PMH><ListRecords><record><header status="deleted"><identifier>oai:oai.bn.pt:bibliografianacional/9</identifier><datestamp>2026-10-16</datestamp></header></record></ListRecords></OAI-PMH>`;
  assert.deepEqual(readMarcRecords(xml), [
    { id: "oai:oai.bn.pt:bibliografianacional/9", datestamp: "2026-10-16", deleted: true, controls: {}, fields: [] }
  ]);
});

test("entities decode and non-sorting markers are stripped, in either document shape", () => {
  const prefixed = `<record><header><identifier>i</identifier><datestamp>2026-10-16</datestamp></header><metadata><mx:record><mx:controlfield tag="001">7</mx:controlfield><mx:datafield tag="200" ind1="1" ind2=" "><mx:subfield code="a">&#x98;A &#152;casa&#x9c; &amp; o &lt;jardim&gt; &quot;novo&quot; d&apos;Água</mx:subfield><mx:subfield code="e"/></mx:datafield></mx:record></metadata></record>`;
  const plain = `<collection><record><controlfield tag="001">7</controlfield><datafield ind1="1" ind2=" " tag="200"><subfield code="a">&#x98;A &#152;casa&#x9c; &amp; o &lt;jardim&gt; &quot;novo&quot; d&apos;Água</subfield><subfield code="e"></subfield></datafield></record></collection>`;
  for (const xml of [prefixed, plain]) {
    const [parsed] = readMarcRecords(xml);
    assert.equal(parsed!.controls["001"], "7");
    assert.deepEqual(parsed!.fields.map((f) => f.subfields.map(([code]) => code)), [["a", "e"]]);
    assert.equal(mapBnpRecord(parsed!).title, `A casa & o <jardim> "novo" d'Água`);
  }
});

test("the Arendt record maps names given-first, its translator and original title", () => {
  const book = mapBnpRecord(byId("1704776"));
  assert.deepEqual(book.isbns, ["9789727089482"]);
  assert.equal(book.title, "A promessa da política");
  assert.equal(book.author, "Hannah Arendt");
  assert.equal(book.translator, "Miguel Serras Pereira");
  assert.equal(book.originalTitle, "The promise of politics");
  assert.equal(book.publisher, "Relógio d'Água");
  assert.equal(book.year, 2007);
  assert.equal(book.pages, 169);
  assert.deepEqual(book.languages, ["por"]);
  assert.ok(book.udc.includes("321.01"));
  assert.equal(book.scanUrl, null);
  assert.equal(book.recordId, "1704776");
});

test("the municipal record keeps its scan as https", () => {
  const book = mapBnpRecord(byId("2047928"));
  assert.equal(book.publisher, "Câmara Municipal de Viana do Castelo");
  assert.equal(book.author, "Bruna Ruschel Pires");
  assert.equal(book.scanUrl, "https://rnod.bnportugal.gov.pt/ImagesBN/winlibimg.aspx?skey=&doc=2047928&img=139512&save=true");
});

test("an ISBN-10 record is canonicalised to ISBN-13", () => {
  const capital = mapBnpRecord(byId("1233005"));
  assert.deepEqual(capital.isbns, ["9789722328012"]);
  assert.equal(capital.author, "Eça de Queirós");
  assert.equal(capital.year, 2003);
  assert.equal(capital.pages, 335);
});

test("the per-ISBN record strips its literal ? markers", () => {
  const [record] = readMarcRecords(urnAllende);
  const book = mapBnpRecord(record!);
  assert.equal(book.title, "A casa dos espíritos");
  assert.equal(book.author, "Isabel Allende");
  assert.equal(book.translator, "Cristina Paixão");
  assert.equal(book.originalTitle, "La casa de los espíritus");
  assert.equal(book.publisher, "Porto Editora");
  assert.equal(book.pages, 407);
  assert.equal(record!.id, null);
  assert.equal(record!.datestamp, null);
  assert.equal(book.scanUrl, "https://rnod.bnportugal.gov.pt/ImagesBN/winlibimg.aspx?skey=&doc=1858036&img=35153&save=true");
});

test("an author comes from 700 and 701, then 702 $4 070, then 702 $4 340, else empty", () => {
  const person = (tag: string, role: string | null, given: string, surname: string): MarcField =>
    field(tag, ["a", surname], ["b", given], ...(role === null ? [] : [["4", role] as [string, string]]));
  assert.equal(book(person("700", null, "Ana", "Silva"), person("701", "340", "Rui", "Costa"), person("702", "070", "Eva", "Reis")).author, "Ana Silva, Rui Costa");
  assert.equal(book(person("702", "340", "Eva", "Reis"), person("702", "070", "Rui", "Costa")).author, "Rui Costa");
  assert.equal(book(person("702", "340", "Eva", "Reis"), person("702", "675", "Ana", "Silva")).author, "Eva Reis");
  assert.equal(book(person("702", "675", "Ana", "Silva")).author, "");
  assert.equal(book().author, "");
});

test("a name keeps its $d epithet", () => {
  assert.equal(book(field("700", ["a", "Bento"], ["d", "XVI"], ["f", "1927-2022"])).author, "Bento XVI");
});

test("translators come from 702 $4 730 and join with e", () => {
  const translator = (given: string, surname: string) => field("702", ["a", surname], ["b", given], ["4", "730"]);
  assert.equal(book().translator, null);
  assert.equal(book(translator("Ana", "Silva")).translator, "Ana Silva");
  assert.equal(book(translator("Ana", "Silva"), translator("Rui", "Costa")).translator, "Ana Silva e Rui Costa");
  assert.equal(book(translator("Ana", "Silva"), translator("Rui", "Costa"), translator("Eva", "Reis")).translator, "Ana Silva, Rui Costa e Eva Reis");
});

test("a publisher loses brackets and the distrib. marker, and [s.n.] is none", () => {
  const publisher = (value: string) => book(field("210", ["c", value])).publisher;
  assert.equal(publisher("[s.n.]"), null);
  assert.equal(publisher("s.n.]"), null);
  assert.equal(publisher("[S. n.]"), null);
  assert.equal(publisher(" "), null);
  assert.equal(publisher("[distrib.]"), null);
  assert.equal(publisher("[Presença] [distrib.]"), "Presença");
  assert.equal(publisher("Distribuidora Nova"), "Distribuidora Nova");
  assert.equal(publisher("Documenta ;"), "Documenta");
  assert.equal(publisher("ICEP;"), "ICEP");
  assert.equal(publisher("Âncora : /,"), "Âncora");
  assert.equal(publisher("s.n. ;"), null);
  assert.equal(publisher(";"), null);
  assert.equal(book().publisher, null);
});

test("a part number and part name follow the title", () => {
  assert.equal(book(field("200", ["a", "Os Maias"], ["h", "2"])).title, "Os Maias. 2");
  assert.equal(book(field("200", ["a", "Os Maias"], ["h", "2"], ["i", "A queda"])).title, "Os Maias. 2. A queda");
  assert.equal(book(field("200", ["a", "Um"], ["a", "Dois"])).title, "Um ; Dois");
  assert.equal(book(field("200", ["a", "?O ?mundo"])).title, "O mundo");
});

test("ISBNs keep only valid ones, canonical and distinct", () => {
  const result = book(field("010", ["a", "978-972-0-04445-8"]), field("010", ["a", "972-708-948-8"]), field("010", ["a", "9789727089482"]), field("010", ["a", "x"]));
  assert.deepEqual(result.isbns, ["9789727089482"]);
  assert.deepEqual(book().isbns, []);
});

test("pages read the largest arabic number before p. and need p.", () => {
  const pages = (value: string) => book(field("215", ["a", value])).pages;
  assert.equal(pages("169, [7] p."), 169);
  assert.equal(pages("XII, 300 p."), 300);
  assert.equal(pages("2 v."), null);
  assert.equal(pages("XII p."), null);
  assert.equal(book().pages, null);
});

test("the year reads 100 $a first, then 210 $d", () => {
  assert.equal(book(field("100", ["a", "20131209d2013    m  y0pory01030103ba"])).year, 2013);
  assert.equal(book(field("100", ["a", "20131209d    "]), field("210", ["d", "D.L. 2015"])).year, 2015);
  assert.equal(book(field("210", ["d", "D.L. 2015"])).year, 2015);
  assert.equal(book(field("100", ["a", "20000301d0000    m  y0pory01030103ba"]), field("210", ["d", "2015"])).year, 2015);
  assert.equal(book(field("100", ["a", "20000301d0000    m  y0pory01030103ba"])).year, null);
  assert.equal(book(field("210", ["d", "s.d."])).year, null);
  assert.equal(book().year, null);
});

test("languages, classification, summary and original title read their own fields", () => {
  const result = book(
    field("101", ["a", "por"], ["c", "eng"]),
    field("101", ["a", "eng"]),
    field("675", ["a", "321.01"]),
    field("675", ["a", "1A/Z(091)"]),
    field("330", ["a", "Um resumo."]),
    field("330", ["a", "Outro."]),
    field("304", ["a", "Nota geral"]),
    field("304", ["a", "Tít. orig.: The promise of politics "]),
    field("856", ["u", "http://example.com/other"]),
    field("856", ["u", "http://rnod.bnportugal.gov.pt/ImagesBN/winlibimg.aspx?doc=1"])
  );
  assert.deepEqual(result.languages, ["por", "eng"]);
  assert.deepEqual(result.udc, ["321.01", "1A/Z(091)"]);
  assert.equal(result.summary, "Um resumo.");
  assert.equal(result.originalTitle, "The promise of politics");
  assert.equal(result.scanUrl, "https://rnod.bnportugal.gov.pt/ImagesBN/winlibimg.aspx?doc=1");
  assert.equal(book().summary, null);
  assert.equal(book().originalTitle, null);
  assert.equal(book(field("304", ["a", "Tít. orig.:"])).originalTitle, null);
  assert.equal(book(field("304", ["a", "Tít. orig.: "])).originalTitle, null);
  assert.equal(book().scanUrl, null);
  assert.equal(mapBnpRecord(record([field("200", ["a", "x"])], { "001": "42" })).recordId, "42");
  assert.equal(book().recordId, null);
});
