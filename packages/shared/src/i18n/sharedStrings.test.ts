import assert from "node:assert/strict";
import { test } from "node:test";
import { roundLabel } from "../arena/arenaBracket.js";
import { toSeedBook } from "../arena/arenaSeed.js";
import { countdownLabel } from "../arena/countdown.js";
import { authFieldErrors, passwordHint, recoveryMessage } from "../auth.js";
import { itemNoun } from "../characters/index.js";
import { playerLabel, quizClueHeading } from "../quizzes/labels.js";
import { genreLabel, BOOK_GENRES } from "../library/bookGenres.js";
import { bookCsvToLibraryJson } from "../library/bookCsv.js";
import { statusLabel } from "../library/covers.js";
import { cardAspectRatioOptions, cardFontFamilyOptions } from "../library/libraryStyle.js";
import { readerIdentity } from "../library/readerIdentity.js";
import { blockLabel, statMetricLabels } from "../murals/murals.js";
import { blockThemeColorLabels } from "../murals/blockTextColors.js";
import { readSavedBlockLooks } from "../murals/savedLooks.js";
import { dailyChapterMonthShare } from "../quizzes/dailyChapter.js";
import { readerCardLabel, readerGlyphLabel } from "../readerCards/card.js";
import { footerLeftText } from "../readerCards/footer.js";
import { counterLabels, finishLabels } from "../readerCards/labels.js";
import { plateName } from "../readerCards/plates.js";
import { bookMetaLine } from "../works/bookScreen.js";
import { bookStatsModel } from "../works/bookStats.js";
import { editionLabel } from "../works/labels.js";
import { fontLabel } from "../themes/fonts.js";
import { themeLabel } from "../themes/palettes.js";
import { aggregationModes } from "../tierlists/results.js";

test("themes and fonts are named in the reader's language", () => {
  assert.equal(themeLabel("dark", "en"), "Dark");
  assert.equal(themeLabel("dark", "pt-PT"), "Escuro");
  assert.equal(fontLabel("system", "pt-PT"), "Sistema");
  assert.equal(fontLabel("playfair", "pt-PT"), "Playfair");
});

test("auth text follows the language", () => {
  assert.equal(passwordHint("en"), "Use at least 8 characters. A longer passphrase is better.");
  assert.match(passwordHint("pt-PT"), /^Utilize pelo menos 8 caracteres/);
  assert.match(recoveryMessage("pt-PT"), /^Se existir uma conta/);
  assert.equal(authFieldErrors("login", "", "", "", "pt-PT").identifier, "Introduza o seu email ou nome de utilizador.");
  assert.equal(authFieldErrors("signup", "a@b.pt", "x", "pw", "pt-PT").password, "Utilize entre 8 e 128 caracteres.");
});

test("arena text follows the language", () => {
  assert.equal(roundLabel(1, 3, "pt-PT"), "Final");
  assert.equal(roundLabel(2, 2, "pt-PT"), "Meias-finais");
  assert.equal(roundLabel(4, 1, "pt-PT"), "Quartos de final");
  assert.equal(roundLabel(8, 1, "pt-PT"), "Ronda 1");
  const now = Date.parse("2026-01-01T00:00:00.000Z");
  assert.equal(countdownLabel("2025-12-31T00:00:00.000Z", "pt-PT", now), "A fechar…");
  assert.equal(countdownLabel("2026-01-04T04:00:00.000Z", "pt-PT", now), "faltam 3 d 4 h");
  assert.equal(countdownLabel("2026-01-04T04:00:00.000Z", "en", now), "3d 4h left");
  assert.equal(toSeedBook({ _workId: "w" }, null, "pt-PT")?.title, "Sem título");
});

test("quiz and tier list text follows the language", () => {
  assert.equal(playerLabel({ playerName: null, anonymous: true }, "pt-PT").name, "Convidado");
  assert.equal(quizClueHeading("title_cover", "pt-PT"), "Que capa pertence a este título?");
  assert.deepEqual(aggregationModes("pt-PT").map((item) => item.label), ["Média", "Mais votado", "Mediana"]);
  assert.equal(itemNoun(undefined, 1, "pt-PT"), "livro");
  assert.equal(itemNoun({}, 2, "pt-PT"), "personagens");
});

test("genres, awards and statuses are named in the reader's language", () => {
  assert.equal(genreLabel("Science Fiction", "en"), "Science Fiction");
  assert.equal(genreLabel("Science Fiction", "pt-PT"), "Ficção científica");
  assert.equal(genreLabel("Biography & Memoir", "pt-PT"), "Biografia e memórias");
  assert.deepEqual(BOOK_GENRES.map((genre) => genreLabel(genre, "pt-PT")).filter((label, index) => label === BOOK_GENRES[index] && !["Romance", "Thriller"].includes(label)), []);
  assert.equal(statusLabel(2, "pt-PT"), "Lido");
  assert.equal(statusLabel(0, "pt-PT"), "Quero ler");
});

test("a streak of one day is singular in Portuguese", () => {
  const summary = (streak: number) => ({ month: "2030-01", days: [], streak, average: 3.5 }) as unknown as Parameters<typeof dailyChapterMonthShare>[0];
  assert.match(dailyChapterMonthShare(summary(1), "https://example.org/daily", "pt-PT"), /\nSequência de 1 dia · média de 3,5\n/);
  assert.match(dailyChapterMonthShare(summary(2), "https://example.org/daily", "pt-PT"), /\nSequência de 2 dias · média de 3,5\n/);
  assert.match(dailyChapterMonthShare(summary(1), "https://example.org/daily", "en"), /\n1-day streak · 3\.5 avg\n/);
});

test("reader identity text follows the language", () => {
  const finished = (count: number) => Array.from({ length: count }, (_, index) => ({ Title: `B${index}`, Attribution: `A${index}`, ReadStatus: 2 }));
  assert.equal(readerIdentity(finished(4), [], "en").missing, "Finish 1 more book");
  assert.equal(readerIdentity(finished(4), [], "pt-PT").missing, "Termine mais 1 livro");
  assert.equal(readerIdentity(finished(2), [], "pt-PT").missing, "Termine mais 3 livros");
  assert.equal(readerIdentity(finished(6), [], "pt-PT").coverage[0], "géneros conhecidos em 0 de 6 livros lidos");
});

test("reader cards are named and described in the reader's language", () => {
  assert.equal(plateName("star", "pt-PT"), "Astrónomo");
  assert.equal(readerGlyphLabel("star", "pt-PT"), "o Astrónomo");
  assert.equal(readerCardLabel({ state: "leaning", identity: "carto" }, "pt-PT"), "Cartão de leitor: o Cartógrafo, a pender");
  assert.equal(counterLabels("pt-PT").dial, "Mostrador");
  assert.equal(finishLabels("pt-PT").gilt, "Corte dourado");
  assert.equal(footerLeftText("plate", { state: "settled", identity: "star", runnerUp: null, signal: null, coverage: [] }, "pt-PT"), "PRANCHA IV");
});

test("import errors, saved looks and block labels follow the language", () => {
  assert.throws(() => bookCsvToLibraryJson("Title,Author\n", "pt-PT"), /não tem nenhum livro/);
  assert.throws(() => readSavedBlockLooks("{}", "pt-PT"), /Não foi possível ler os estilos guardados\./);
  assert.equal(blockLabel("readerCard", "pt-PT"), "Cartão de leitor");
  assert.equal(statMetricLabels("pt-PT").totalBooks, "Livros na sua biblioteca");
  assert.equal(blockThemeColorLabels("pt-PT").onAccent, "Sobre o realce");
  assert.equal(cardFontFamilyOptions("en")[0]!.shortLabel, "Sans-serif");
  assert.equal(cardFontFamilyOptions("pt-PT")[0]!.shortLabel, "Sem serifa");
  assert.deepEqual(cardAspectRatioOptions("pt-PT").map((option) => option.label), ["Cartaz (2:3)", "Retrato (3:4)", "Quadrado (1:1)"]);
});

test("book screens and stats follow the language", () => {
  const stats = { community: { average: 4, count: 4, distribution: [0, 0, 0, 4, 0] as [number, number, number, number, number] }, tiers: { score: 0.1, letter: "S" as const, lists: 1, ballots: 5 }, tournaments: null };
  const model = bookStatsModel(stats, { value: 4.2, count: 1 }, "pt-PT");
  assert.equal(model.ratings.community!.feeling, "Adorei");
  assert.equal(model.ratings.community!.summary, "média de 4,0 · 4 classificações");
  assert.equal(model.ratings.openLibrary, "★ 4,2 · 1 classificação na Open Library");
  assert.deepEqual(model.tiles[1], { key: "tiers", value: "Topo", caption: "nível · 1 lista" });
  assert.equal(model.tierBar!.band, "Nível de topo");
  assert.equal(model.tournamentsEmpty, "Ainda não está em nenhum torneio.");
  assert.equal(bookMetaLine({ year: 1965, pages: 1 }, "pt-PT"), "1965 · 1 página");
  assert.equal(editionLabel({ bookId: "b", title: "T", language: null, year: null, isbn: null, coverUrl: null, coverColor: null, pages: null, mine: false }, "pt-PT"), "Detalhes da edição desconhecidos");
});
