import assert from "node:assert/strict";
import { test } from "node:test";
import { fillLossy, hasCopyrightSign, isLossy, retitle, retitleRepairs, textOf, wantsRetitle } from "./lossy.js";

test("a © takes one accented letter, and an ASCII letter in its place is refused", () => {
  assert.equal(fillLossy("P©ssaro Azul", "Pássaro Azul"), "Pássaro Azul");
  assert.equal(fillLossy("P©ssaro Azul", "Passaro Azul"), null);
});

test("two characters for one letter, or a different length, are refused", () => {
  assert.equal(fillLossy("V©Øo Alto", "Vôo Alto"), null);
  assert.equal(fillLossy("P©ssaro", "Pássaros"), null);
});

test("the other characters must match ignoring case, and the candidate's capitals are kept", () => {
  assert.equal(fillLossy("Hist©ria Do Mar", "História do Mar"), "História do Mar");
  assert.equal(fillLossy("Hist©ria Do Mar", "História de Mar"), null);
});

test("an all-caps candidate is refused for mixed-case text and accepted for all-caps text", () => {
  assert.equal(fillLossy("Hist©ria Do Mar", "HISTÓRIA DO MAR"), null);
  assert.equal(fillLossy("HIST©RIA DO MAR", "HISTÓRIA DO MAR"), "HISTÓRIA DO MAR");
});

test("a candidate is repaired, composed and trimmed before it is compared", () => {
  assert.equal(fillLossy("P©ssaro", "PÃ¡ssaro"), "Pássaro");
  assert.equal(fillLossy("P©ssaro", "Pássaro"), "Pássaro");
  assert.equal(fillLossy("  P©ssaro ", " Pássaro  "), "Pássaro");
});

test("a © at the start or the end of a word is filled too", () => {
  assert.equal(fillLossy("©gua Viva", "Água Viva"), "Água Viva");
  assert.equal(fillLossy("Mam© Azul", "Mamã Azul"), "Mamã Azul");
});

test("text without a ©, or with a real © sign, is never changed", () => {
  assert.equal(fillLossy("Livro Azul", "Livro Azul"), null);
  assert.equal(fillLossy("Livro Azul", "Lívro Azul"), null);
  assert.equal(fillLossy("Marca© Azul", "Marca© Azul"), null);
});

test("isLossy needs a © between two letters", () => {
  assert.equal(isLossy("P©ssaro"), true);
  assert.equal(isLossy("Mam© Azul"), false);
  assert.equal(isLossy("© 2010"), false);
});

test("hasCopyrightSign looks at the title and the author", () => {
  assert.equal(hasCopyrightSign({ title: "Mam© Azul", author: "Ana Lima" }), true);
  assert.equal(hasCopyrightSign({ title: "Livro", author: "In©s Duarte" }), true);
  assert.equal(hasCopyrightSign({ title: "Livro", author: "Ana Lima" }), false);
});

test("a new book wants a re-title when its title or author is lossy and its ISBN is valid", () => {
  assert.equal(wantsRetitle({ title: "P©ssaro", author: "Ana Lima", isbn: "9789720000101" }), true);
  assert.equal(wantsRetitle({ title: "Pássaro", author: "In©s Duarte", isbn: "972000000X" }), true);
  assert.equal(wantsRetitle({ title: "Pássaro", author: "Ana Lima", isbn: "9789720000101" }), false);
  assert.equal(wantsRetitle({ title: "P©ssaro", author: "Ana Lima", isbn: null }), false);
  assert.equal(wantsRetitle({ title: "P©ssaro", author: "Ana Lima", isbn: "not an isbn" }), false);
});

test("the title takes the first candidate the rule accepts", () => {
  assert.deepEqual(
    retitle({ title: "P©ssaro Azul", author: "Ana Lima" }, { titles: ["Outro Livro", "Pássaro Azul", "Pàssaro Azul"], authors: [] }),
    { title: "Pássaro Azul", author: "Ana Lima" }
  );
});

test("only the lossy author names change, whatever order the candidates come in", () => {
  const book = { title: "Livro Azul", author: "Ana Lima, In©s Duarte, J©lio Reis" };
  assert.deepEqual(retitle(book, { titles: [], authors: ["Júlio Reis", "Inês Duarte"] }), { title: "Livro Azul", author: "Ana Lima, Inês Duarte, Júlio Reis" });
  assert.deepEqual(retitle(book, { titles: [], authors: ["Inês Duarte"] }), { title: "Livro Azul", author: "Ana Lima, Inês Duarte, J©lio Reis" });
});

test("a lossy name written last-first stays when the candidates are first-last", () => {
  assert.equal(retitle({ title: "Livro Azul", author: "Duarte, In©s" }, { titles: [], authors: ["Inês Duarte"] }), null);
});

test("nothing the rule accepts gives null", () => {
  assert.equal(retitle({ title: "P©ssaro", author: "Ana Lima" }, { titles: ["Outro"], authors: ["Ana Lima"] }), null);
});

test("the repairs carry the old and new text, and the work only while it holds the book's old text", () => {
  const book = { id: "b1", title: "P©ssaro", author: "Ana Lima", isbn: "9789720000101", work_id: "w1", work_title: "P©ssaro", work_author: "Ana Lima" };
  const next = { title: "Pássaro", author: "Ana Lima" };
  assert.deepEqual(retitleRepairs(book, next, "isbndb"), {
    book: { id: "b1", title: "P©ssaro", author: "Ana Lima", repairedTitle: "Pássaro", repairedAuthor: "Ana Lima", origin: "isbndb" },
    work: { id: "w1", title: "P©ssaro", author: "Ana Lima", repairedTitle: "Pássaro", repairedAuthor: "Ana Lima" }
  });
  assert.equal(retitleRepairs({ ...book, work_title: "Pássaro" }, next, "isbndb").work, null);
  assert.equal(retitleRepairs({ ...book, work_id: null, work_title: null, work_author: null }, next, "isbndb").work, null);
});

test("textOf joins title and author", () => {
  assert.equal(textOf({ title: "P©ssaro", author: "Ana Lima" }), "P©ssaro — Ana Lima");
});
