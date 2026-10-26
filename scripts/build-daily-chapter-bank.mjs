import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DAILY_CHAPTER_QUOTE_RIGHTS, DAILY_CHAPTER_THEMES, generateQuizQuestions } from '@scripta/shared';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const bookId = (book) => 'book-' + sha256(book.title + '\0' + book.author + '\0' + book.language).slice(0, 24);

export function buildBank(sources, launch) {
  const books = new Map();
  for (const edition of launch.editions) {
    for (const question of edition.questions) {
      const book = { title: question.book.title, author: question.book.author, language: launch.language ?? 'en' };
      const id = bookId(book);
      const previous = books.get(id);
      books.set(id, { id, ...book, themeIds: [...new Set([...(previous?.themeIds ?? []), edition.themeId])] });
    }
  }
  for (const source of sources) {
    const book = { title: source.repository === 'daniel-defoe_the-life-and-adventures-of-robinson-crusoe' ? 'Robinson Crusoe' : source.title, author: source.author, language: source.language };
    const id = bookId(book);
    const previous = books.get(id);
    books.set(id, { id, ...book, themeIds: [...new Set([...(previous?.themeIds ?? []), ...source.themeIds])] });
  }
  const questions = [];
  const proofs = [];
  for (const source of sources) {
    const title = source.repository === 'daniel-defoe_the-life-and-adventures-of-robinson-crusoe' ? 'Robinson Crusoe' : source.title;
    const target = books.get(bookId({ title, author: source.author, language: source.language }));
    const proof = { repository: source.repository, revision: source.revision, bookId: target.id, sourceTitle: source.title, sourceLanguage: source.sourceLanguage, translators: source.translators, metadataSha256: source.metadataSha256, passages: [] };
    for (const passage of source.passages) {
      const textSha256 = sha256(passage.text);
      const id = 'se-' + sha256(source.repository + '\0' + passage.text).slice(0, 32);
      const pool = [...books.values()].map((book) => ({ ...book, coverUrl: null, blurb: null, quote: book.id === target.id ? passage.text : null }));
      const [draw] = generateQuizQuestions(pool, { questionCount: 1, allowedTypes: ['quote_title'] }, id);
      assert.ok(draw);
      const location = (passage.section || passage.path.split('/').at(-1)) + ', paragraph ' + passage.paragraph;
      const translation = source.translators.length ? '; translation by ' + source.translators.join(', ') : '';
      const sourceUrl = `https://github.com/standardebooks/${source.repository}/blob/${source.revision}/${passage.path}`;
      questions.push({ id, bookId: target.id, type: 'quote_title', prompt: passage.text, options: draw.options, answerIndex: draw.answerIndex, explanation: `From ${source.title} by ${source.author}${translation}. ${location}.`, sourceUrl, sourceEdition: `Standard Ebooks: ${source.title}${translation}; ${source.sourceLanguage}; ${location}; revision ${source.revision}`, rights: { ...DAILY_CHAPTER_QUOTE_RIGHTS, evidence: `${DAILY_CHAPTER_QUOTE_RIGHTS.evidence} Source file SHA-256 ${passage.fileSha256}; whitespace-normalized text SHA-256 ${textSha256}.` }, approved: false });
      proof.passages.push({ questionId: id, path: passage.path, paragraph: passage.paragraph, section: passage.section, fileSha256: passage.fileSha256, textSha256 });
    }
    proofs.push(proof);
  }
  assert.equal(new Set(questions.map((question) => question.id)).size, questions.length);
  assert.ok(questions.every((question) => question.options[question.answerIndex] === books.get(question.bookId).title));
  return { status: 'Source-matched candidates awaiting editorial review. Quotation rights assumed cleared by project-owner instruction. No editions.', books: [...books.values()], questions, sources: proofs };
}

export function coverageReport(bank) {
  const sourceBooks = new Set(bank.questions.map((question) => question.bookId));
  const missing = bank.books.filter((book) => !sourceBooks.has(book.id));
  return `# Daily Chapter quotation candidates\n\n${bank.questions.length} exact source-matched passages from ${sourceBooks.size} books; ${bank.books.length} target books total, including the launch roster. **0 approved quotations and 0 scheduled editions in this bank.** These counts describe candidates, not the agreed 500 quiz-ready quotation reserve.\n\nFive whole paragraphs per source book, 8–60 words each, selected from the first three body-text chapters with suitable passages where available. Whitespace is collapsed; wording and punctuation are retained. Chapter headings, epigraphs and paragraphs with note references are excluded. Selection is mechanical: difficulty, spoilers, discriminatory language, ambiguity, distractors, theme fit and the explanation need editorial review. Some passages may be unsuitable. Theme tags are draft classifications of books; a passage need not express every book theme.\n\nEach question links to a fixed Git revision and records its translation, paragraph location, source-file hash and normalized-text hash. Source metadata and proof locations are included in the JSON. Quotation reuse rights are assumed cleared on the project owner's instruction. Candidates remain unapproved only for editorial review; rights are not a pending task.\n\n## Candidate coverage by theme\n\nBooks may belong to several themes; rows cannot be added together. Ready reserve remains zero in every row. A proposed reserve of three editions needs 15 suitable questions and at least 10 different books, with five different books within each edition.\n\n| Theme | Candidate books / targets | Candidate passages |\n|---|---:|---:|\n` + DAILY_CHAPTER_THEMES.map((theme) => {
    const targets = bank.books.filter((book) => book.themeIds.includes(theme.id));
    const ids = new Set(targets.map((book) => book.id));
    return `| ${theme.name} | ${targets.filter((book) => sourceBooks.has(book.id)).length} / ${targets.length} | ${bank.questions.filter((question) => ids.has(question.bookId)).length} |`;
  }).join('\n') + `\n\n## Launch books still needing quotations\n\n${missing.length} launch targets have no quotation candidate in this bank. Source discovery and editorial review remain pending; quotation rights are assumed cleared. This classics bank does not establish broad contemporary-book coverage.\n\n` + missing.map((book) => `- ${book.title} — ${book.author}`).join('\n') + '\n\nAncient Homer passages do not supply quotations from Circe, The Song of Achilles or Ariadne. Those titles remain separate targets. English quotations do not establish Portuguese edition coverage.\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sources = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const launch = JSON.parse(readFileSync('docs/superpowers/specs/2026-10-25-daily-chapter-editorial.json', 'utf8'));
  const bank = buildBank(sources, launch);
  assert.equal(bank.questions.length, 500);
  assert.equal(new Set(bank.questions.map((question) => question.bookId)).size, 100);
  writeFileSync('docs/daily-chapter/candidate-bank.json', JSON.stringify(bank, null, 2) + '\n');
  writeFileSync('docs/daily-chapter/coverage.md', coverageReport(bank));
  console.log(`${bank.questions.length} candidates, ${bank.books.length} targets; all unapproved`);
}
