import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanWorkSubjects, personNameKey } from "./workSubjects.js";

const clean = (people: string[], subjects: string[], authors: string[] = []) =>
  cleanWorkSubjects({ people, places: [], times: [], subjects, authors });

test("pride and prejudice keeps all 14 in order", () => {
  const result = clean(["Elizabeth Bennet", "Fitzwilliam Darcy", "Charlotte Lucas", "George Wickham", "Mr. Bennet", "Mrs. Bennet", "Jane Bennet", "Mary Bennet", "Catherine Bennet", "Lydia Bennet", "Charles Bingley", "Caroline Bingley", "William Collins", "Catherine de Bourgh"], ["Fiction, Romance, Historical, Regency"]);
  assert.equal(result.subjects.person.length, 14);
  assert.equal(result.subjects.person[0], "Elizabeth Bennet");
  assert.equal(result.gatedOut, false);
});

test("1984 drops the dated author heading", () => {
  const result = clean(["Big Brother", "Emmanuel Goldstein", "Thought Police", "Winston Smith", "Julia", "O'Brien", "Aaronson", "Jones", "Rutherford", "Ampleforth", "God", "Rudyard Kipling", "Charrington", "Katharine Smith", "Tom Parsons", "Mrs. Parsons", "Syme", "Leonard Moore", "René-Noël Raimbault", "George Orwell (1862-1931)"], ["Fiction", "censorship"], ["George Orwell"]);
  assert.deepEqual(result.subjects.person.slice(0, 3), ["Big Brother", "Emmanuel Goldstein", "Thought Police"]);
  assert.ok(result.subjects.person.every((name) => !name.includes("Orwell")));
});

test("qualifier and honorific variants merge", () => {
  const result = clean(["Mr. Sherlock Holmes (Fictional character)", "Dr. Watson (Fictional character)", "Sherlock Holmes", "John H. Watson (Fictitious character)", "Inspector Lestrade"], []);
  assert.deepEqual(result.subjects.person, ["Sherlock Holmes", "Dr. Watson", "John H. Watson", "Inspector Lestrade"]);
});

test("non-fiction is gated out", () => {
  for (const [people, subjects] of [
    [["Adolf Hitler (1889-1945)", "Neville Chamberlain (1869-1940)"], ["History", "Third Reich"]],
    [["Abraham Lincoln", "William H. Seward"], ["Nonfiction", "American Civil War", "Non-fiction"]],
  ] as const) {
    const result = clean([...people], [...subjects]);
    assert.deepEqual(result.subjects.person, []);
    assert.equal(result.gatedOut, true);
  }
});

test("gate words", () => {
  for (const subject of ["Juvenile fiction", "Ficção portuguesa", "Ficción", "Graphic novels", "Romance", "Romans"]) {
    assert.equal(clean(["A B", "C D", "E F"], [subject]).subjects.person.length, 3, subject);
  }
});

test("the author is dropped by key", () => {
  assert.deepEqual(clean(["Jane Austen", "Elizabeth Bennet"], ["Fiction"], ["Jane Austen"]).subjects.person, ["Elizabeth Bennet"]);
});

test("three digits drop a name", () => {
  assert.deepEqual(clean(["HAL 9000", "William Shakespeare (1564-1616)", "R2-D2"], ["Fiction"]).subjects.person, ["R2-D2"]);
});

test("one-word honorific stays distinct", () => {
  assert.notEqual(personNameKey("Mr. Bennet"), personNameKey("Bennet"));
  assert.equal(personNameKey("Mr. Sherlock Holmes"), personNameKey("Sherlock Holmes"));
});

test("dracula drops translated headings, inverts and merges", () => {
  const result = clean(["Count Dracula (fictitious character)", "Bram Stoker (1847-1912)", "Dracula Count (Fictitious character)", "Dracula, Conde (Personaje literario)", "Dracula, Count (Fictitious character)", "Van Helsing"], ["Fiction"], ["Bram Stoker"]);
  assert.deepEqual(result.subjects.person, ["Count Dracula", "Van Helsing"]);
});

test("crime and punishment merges name variants", () => {
  const result = clean(["Fyodor Dostoyevsky (1821-1881)", "Rodion Raskolnikov", "Rodion Romanovich Raskolnikov", "Porfiry Petrovich", "Sofia Semyonovna Marmeladova", "Avdotya Romanovna Raskolnikova", "Arkady Ivanovich Svidrigailov", "Dmitri Prokofich Razumikhin"], ["Fiction"], ["Fiódor Dostoievski", "Fyodor Dostoevsky"]);
  assert.deepEqual(result.subjects.person.slice(0, 3), ["Rodion Raskolnikov", "Porfiry Petrovich", "Sofia Semyonovna Marmeladova"]);
});

test("odyssey strips parentheticals and drops other-language duplicates", () => {
  const result = clean(["Homer", "Odysseus (Greek mythology)", "Odysseus King of Ithaca (Mythological character)", "Achilles (Greek mythology)", "Calypso (Greek mythology)", "Achille (Mythologie grecque)", "Ulysse (Mythologie grecque)", "Penelope (Greek mythology)"], ["Fiction"], ["Ὅμηρος", "Homer"]);
  assert.deepEqual(result.subjects.person, ["Odysseus King of Ithaca", "Achilles", "Calypso", "Penelope"]);
});

test("name keys ignore word order", () => {
  assert.equal(personNameKey("Count Dracula"), personNameKey("Dracula Count"));
  assert.deepEqual(clean(["Jane Austen", "Emma Woodhouse"], ["Fiction"], ["Austen, Jane"]).subjects.person, ["Emma Woodhouse"]);
});

test("a single word merges only into one candidate", () => {
  assert.deepEqual(clean(["George Weasley", "George Wickham", "George"], ["Fiction"]).subjects.person, ["George Weasley", "George Wickham", "George"]);
  assert.deepEqual(clean(["Harry", "Harry Potter"], ["Fiction"]).subjects.person, ["Harry Potter"]);
});

test("a single-word alias keeps the group's earliest position", () => {
  assert.deepEqual(clean(["Harry", "Ron Weasley", "Harry Potter"], ["Fiction"]).subjects.person, ["Harry Potter", "Ron Weasley"]);
});

test("places and times are trimmed and de-duplicated, ungated", () => {
  const result = cleanWorkSubjects({ people: [], places: ["England", " England ", "London"], times: [], subjects: ["History"], authors: [] });
  assert.deepEqual(result.subjects.place, ["England", "London"]);
});

test("missing fields are empty", () => {
  assert.deepEqual(cleanWorkSubjects({ people: undefined, places: null, times: 3, subjects: undefined, authors: undefined }), { subjects: { person: [], place: [], time: [] }, gatedOut: false });
});
