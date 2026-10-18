import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanSummary } from "./summaryCleaning.js";

const P = "Uma rapariga parte de Lisboa à procura do irmão desaparecido e descobre uma cidade que não conhecia.";
const cases: Array<[string, string, string | null]> = [
  ["a trailing Detalhes heading with the rest of the block gone", `${P}\n\nDetalhes\n\nCitações`, P],
  ["presença details block", `${P}\n\nDetalhes\n\nTítulo Original THE LOST BROTHER\n\nCategoria Ficção\n\nSub-categoria Romance\n\nSérie Lisboa\n\nNº de Páginas 320\n\nData de Lançamento 03/2024\n\nDimensões 230 x 150 x 20 mm\n\nFormato Capa Mole\n\nPeso 420g\n\nAutores Ana Lima\n\nCitações\n\nCríticas\n\nPrémios`, P],
  ["favourites chrome", `${P}\n\nAdicionar aos Favoritos\n\nAdicionar aos FavoritosJá se encontra nos favoritos`, P],
  ["labels without colon", `${P}\n\nTítulo original Island\n\nTradução Maria Dias\n\n3.ª reimpressão Outubro 2024\n\nPáginas 464\n\nFormato 13 x 21 cm\n\nEAN 9789898327123\n\n[data_lancamento]2024-05-01`, P],
  ["open library tail", "First paragraph.\r\n\r\n----------\r\nAlso contained in:\r\n - [Novels][1]\r\n\r\n  [1]: https://openlibrary.org/works/OL1W", "First paragraph."],
  ["open library source lines", "Buona lettura,\r\nGli editori\r\n([source][1])\r\n\r\n  [1]: https://example.org/x", "Buona lettura,\nGli editori"],
  ["from url", "It lasts.\r\n\r\n(From https://en.wikipedia.org/wiki/X)", "It lasts."],
  ["source url", "It lasts.\n\nSource: http://www.example.org/works/", "It lasts."],
  ["leftover html", "<b>Entre o passado e o futuro.</b> <p></p> Chegou a altura.", "Entre o passado e o futuro.\n\nChegou a altura."],
  ["c1 punctuation", "Disse\u0085 e saiu \u0097 sem olhar para \u0093trás\u0094.", "Disse… e saiu — sem olhar para “trás”."],
  ["mojibake", "JosÃ© partiu de manhÃ£ cedo para a cidade.", "José partiu de manhã cedo para a cidade."],
  ["glued sentence", "They expect the summers will go on forever.In this novel, time passes.", "They expect the summers will go on forever. In this novel, time passes."],
  ["leading label", "SINOPSE Plano Nacional de Leitura, livro recomendado para o 1.º ano.", "Plano Nacional de Leitura, livro recomendado para o 1.º ano."],
  ["leading label with colon", "Sinopse: Uma viagem longa pelo interior do país.", "Uma viagem longa pelo interior do país."],
  ["inline tag between paragraphs", "Parágrafo um com <i>Dune</i>.\n\nParágrafo dois.", "Parágrafo um com Dune.\n\nParágrafo dois."],
  ["double-escaped html", "&amp;lt;b&amp;gt;Entre o passado e o futuro.&amp;lt;/b&amp;gt;", "Entre o passado e o futuro."],
  ["leading label line", "Resumo\n\nO leitor curioso encontra aqui a resposta.", "O leitor curioso encontra aqui a resposta."],
  ["hyphenated wrap", "Um silêncio rigoro-\n\nso, feito de planos contínuos.", "Um silêncio rigoroso, feito de planos contínuos."],
  ["wrapped prose", "Esta é a história de um rapaz que vivia numa ilha pequena, com os\n\nseus barcos de papel e a sua linda cabra branca, e usava um longo\n\ncasaco que o vento levantava. Um dia decidiu partir e chegou a\n\nLisboa, onde encontrou um amigo.", "Esta é a história de um rapaz que vivia numa ilha pequena, com os seus barcos de papel e a sua linda cabra branca, e usava um longo casaco que o vento levantava. Um dia decidiu partir e chegou a Lisboa, onde encontrou um amigo."],
  ["markdown", "*Mrs. Dalloway* became the **inspiration** for \\[a\\] novel.", "Mrs. Dalloway became the inspiration for [a] novel."],
  ["spaces", "One  sentence\there.\n\n\n\nNext.  ", "One sentence here.\n\nNext."],
  ["open library markdown", [
    "In this thrilling sequel to *A Game of Thrones*, **George R. R. Martin** returns.",
    "",
    "*A Clash of Kings*",
    "",
    "Preceded by: [*A Game of Thrones*][1]",
    "Followed by: [A Storm of Swords](https://openlibrary.org/works/OL257914W)",
    "",
    "([Source][2])",
    "",
    "[1]: https://openlibrary.org/works/OL257943W",
    "[2]: https://georgerrmartin.com/grrm_book/a-clash-of-kings/"
  ].join("\n"), [
    "In this thrilling sequel to A Game of Thrones, George R. R. Martin returns.",
    "",
    "A Clash of Kings",
    "",
    "Preceded by: A Game of Thrones",
    "Followed by: A Storm of Swords"
  ].join("\n")],
  ["contents list and rule", [
    "Frodo Baggins, Bilbo's heir...and he is resolved to bear it to its end. Or his own.",
    "",
    "---",
    "",
    "Contains",
    "",
    "- The Fellowship of the Ring",
    "- [The Lord of the Rings \\[2/2\\]](https://openlibrary.org/works/OL27306128W)",
    "- [The Lord of the Rings \\[1/6\\]](https://openlibrary.org/works/OL24170898W)"
  ].join("\n"), [
    "Frodo Baggins, Bilbo's heir...and he is resolved to bear it to its end. Or his own.",
    "",
    "Contains",
    "",
    "- The Fellowship of the Ring",
    "- The Lord of the Rings [2/2]",
    "- The Lord of the Rings [1/6]"
  ].join("\n")],
  ["hyphen before a clitic is left alone", "O capitão olhou para o mar durante muito tempo e depois disse-\nlhe que partia na manhã seguinte, sem dizer mais nada a ninguém. A mãe deu-\n\nse conta do que se passava.", "O capitão olhou para o mar durante muito tempo e depois disse-\nlhe que partia na manhã seguinte, sem dizer mais nada a ninguém. A mãe deu-\n\nse conta do que se passava."],
  ["word split before a clitic-like syllable is left alone", "A criança chegou cedo à esco-\nla da aldeia e ficou à espera do professor.", "A criança chegou cedo à esco-\nla da aldeia e ficou à espera do professor."],
  ["contains line in running text", "A collection of stories.\n\nContains: three novellas and twelve short stories.\n\nIn the title story, a young woman leaves.", "A collection of stories.\n\nContains: three novellas and twelve short stories.\n\nIn the title story, a young woman leaves."],
  ["contains line before a list", "A collection of stories.\n\nContains: the saga\n\n- One\n- Two", "A collection of stories."],
  ["bare contains line", "A collection of stories.\n\nContains:", "A collection of stories."],
  ["presença block ending in a capitalised author line", "Sinopse omitida.\n\nTítulo Original Ultimate football Heroes 2027\n\nISBN 9789722380577\n\nNº de Páginas 352\n\nAutores Emily Stead, Matt Oldfield, Dan Leydon, Seth Burkett, John Murray", "Sinopse omitida."],
  ["detalhes block with capitalised values", "Texto bom aqui.\n\nDetalhes\n\nAutores Emily Stead, Matt Oldfield\n\nFormato Capa Mole", "Texto bom aqui."],
  ["asterisks hug the words", "5 * 3 * 2 is *thirty*, **really**.", "5 * 3 * 2 is thirty, really."],
  ["fragment kept", "Texto curto.", "Texto curto."]
];

for (const [name, input, expected] of cases) {
  test(`cleanSummary: ${name}`, () => {
    assert.equal(cleanSummary(input), expected);
    assert.equal(cleanSummary(expected ?? ""), expected);
  });
}

const unchanged = [
  "Levo no bolso uma pedra do rio\n\ne uma folha que o vento esqueceu,\n\nguardo-as para o inverno.",
  "Formato de bolso, este livro reúne contos de verão.",
  "Edição revista e aumentada, com um novo prefácio do autor.",
  "Data de 1922 o primeiro manuscrito conhecido desta obra.",
  "Visite www.editora.pt/livros.Novidades para mais.",
  "Sinopse da editora.",
  "Resumo de uma vida, contado pela filha.",
  "Os E.U.A. e o Sr.Silva.",
  "Contains: the complete trilogy of the saga.\n\nUma história sobre três irmãos que partem para o mar em busca de fortuna.",
  "Source: https://x.org/a\n\nA história continua com muita acção e aventura pelo mundo.",
  "Série Negra\n\nUm detective chega a uma cidade em silêncio.",
  "Peso Pesado\n\nUm pugilista tenta voltar ao ringue.",
  "Autores Portugueses do século XX reunidos neste volume\n\nTexto.",
  "Ano 2000: o mundo muda para sempre\n\nUma crónica do fim de século.",
  "Data 1922 foi o ano\n\nOutra frase.",
  P
];

unchanged.push("Série Negra\n\nUm detective chega a uma cidade onde ninguém fala.", "Autores Portugueses do século XX reunidos neste volume\n\nTexto.");

for (const text of unchanged) {
  test(`cleanSummary keeps: ${text.slice(0, 40)}`, () => {
    assert.equal(cleanSummary(text), text);
  });
}

test("a summary that is only chrome or metadata is none", () => {
  assert.equal(cleanSummary("Título original Island\n\nPáginas 464"), null);
  assert.equal(cleanSummary("Adicionar aos Favoritos"), null);
  assert.equal(cleanSummary("  "), null);
});

test("a verse line that starts with a label word and ends a sentence is kept", () => {
  assert.equal(cleanSummary("Série de quedas, a cada passo.\n\nTexto do livro."), "Série de quedas, a cada passo.\n\nTexto do livro.");
});
