import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeHtmlEntities, htmlToText } from "./htmlText.js";

test("block tags make paragraphs and br makes a line", () => {
  assert.equal(htmlToText("<p>Um.<br>Dois.</p><p>Três.</p>"), "Um.\nDois.\n\nTrês.");
});

test("source whitespace in HTML collapses to one space", () => {
  assert.equal(htmlToText("<p>Uma frase\n   partida no código.</p>"), "Uma frase partida no código.");
});

test("text with no block tags keeps its newlines", () => {
  assert.equal(htmlToText("Linha um,\nlinha dois.\n\nOutro parágrafo &amp; fim."), "Linha um,\nlinha dois.\n\nOutro parágrafo & fim.");
  assert.equal(htmlToText("Parágrafo um com <i>x</i>.\n\nParágrafo dois."), "Parágrafo um com x.\n\nParágrafo dois.");
});

test("comments and processing instructions go", () => {
  assert.equal(htmlToText("<p><!--StartFragment-->Texto.<!-- fim --></p><?xml:namespace prefix = o />"), "Texto.");
});

test("double-escaped markup decodes fully", () => {
  assert.equal(htmlToText("&amp;lt;b&amp;gt;Título&amp;lt;/b&amp;gt; e mais"), "Título e mais");
});

test("escaped tags are removed after decoding", () => {
  assert.equal(htmlToText("&lt;i&gt;Resurrection&lt;/i&gt;, the last novel"), "Resurrection, the last novel");
  assert.equal(htmlToText("<p>I &lt;3 books</p>"), "I <3 books");
});

test("escaped structural tags keep their breaks", () => {
  assert.equal(htmlToText("Rosa&lt;br&gt;do mar"), "Rosa\ndo mar");
  assert.equal(htmlToText("&lt;p&gt;Um.&lt;/p&gt;&lt;p&gt;Dois.&lt;/p&gt;"), "Um.\n\nDois.");
});

test("script, style and table cells", () => {
  assert.equal(htmlToText("<style>p{}</style><script>x()</script><table><tr><td>A</td><td>B</td></tr></table>"), "A B");
});

test("entities", () => {
  assert.equal(decodeHtmlEntities("&#8211; &#x2014; &hellip; &euro; &sect; &times; a&shy;b &nbsp;x &#99999999;"), "– — … € § × ab  x &#99999999;");
  assert.equal(decodeHtmlEntities("&constructor; &toString; &__proto__;"), "&constructor; &toString; &__proto__;");
});
