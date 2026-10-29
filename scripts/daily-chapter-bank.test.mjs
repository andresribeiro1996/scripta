import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { buildBank } from './build-daily-chapter-bank.mjs';
import { DAILY_CHAPTER_QUOTE_RIGHTS } from '@scripta/shared';

test('source parser retains inline wording and punctuation while excluding headers, epigraphs and note references', () => {
  const result = spawnSync('python3', ['-c', `
import importlib.util
spec = importlib.util.spec_from_file_location('sources', 'scripts/daily-chapter-sources.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
data = b'''<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body epub:type="bodymatter"><section id="chapter-1"><header><p>This heading has enough words to pass the length test.</p></header><p>One <i>complete</i> paragraph, with <abbr>Mr.</abbr> Bennet and its original punctuation.</p><blockquote epub:type="epigraph"><p>This quotation must not be mistaken for the author's prose.</p></blockquote><p>This paragraph contains a note that needs to be excluded.<a epub:type="noteref">1</a></p><p>One <i>complete</i> paragraph, with <abbr>Mr.</abbr> Bennet and its original punctuation.</p></section></body></html>'''
assert module.passages(data) == [{'text': 'One complete paragraph, with Mr. Bennet and its original punctuation.', 'paragraph': 2, 'section': 'chapter-1'}]
assert module.passages(data.replace(b'bodymatter', b'frontmatter')) == []
`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('committed bank has 500 unique unapproved passages with traceable editions and deterministic choices', () => {
  const bank = JSON.parse(readFileSync('docs/daily-chapter/candidate-bank.json', 'utf8'));
  const pins = JSON.parse(readFileSync('docs/daily-chapter/sources.json', 'utf8'));
  const launch = JSON.parse(readFileSync('docs/superpowers/specs/2026-10-25-daily-chapter-editorial.json', 'utf8'));
  const questions = new Map(bank.questions.map((question) => [question.id, question]));
  assert.equal(questions.size, 500);
  assert.equal(new Set(bank.questions.map((question) => question.bookId)).size, 100);
  assert.equal(bank.books.length, 164);
  assert.ok(bank.questions.every((question) => !question.approved));
  assert.ok(bank.questions.every((question) => question.rights.basis === DAILY_CHAPTER_QUOTE_RIGHTS.basis && question.rights.evidence.startsWith(DAILY_CHAPTER_QUOTE_RIGHTS.evidence)));
  assert.equal(bank.editions, undefined);
  const sources = bank.sources.map((source) => {
    const pin = pins.find((pin) => pin.repository === source.repository);
    assert.equal(pin.revision, source.revision);
    assert.equal(source.passages.length, 5);
    assert.match(source.metadataSha256, /^[a-f0-9]{64}$/);
    const book = bank.books.find((book) => book.id === source.bookId);
    return { ...pin, title: source.sourceTitle, author: book.author, language: book.language, sourceLanguage: source.sourceLanguage, translators: source.translators, metadataSha256: source.metadataSha256, passages: source.passages.map((passage) => {
      const question = questions.get(passage.questionId);
      assert.equal(question.bookId, book.id);
      assert.equal(createHash('sha256').update(question.prompt).digest('hex'), passage.textSha256);
      assert.match(passage.fileSha256, /^[a-f0-9]{64}$/);
      assert.ok(question.sourceUrl.endsWith(source.revision + '/' + passage.path));
      return { ...passage, text: question.prompt };
    }) };
  });
  assert.deepEqual(buildBank(sources, launch), bank);
});

test('reviewed launch contains 70 distinct books, balanced choices and matching quote proofs', () => {
  const pack = JSON.parse(readFileSync('docs/daily-chapter/launch-fortnight.json', 'utf8'));
  const bank = JSON.parse(readFileSync('docs/daily-chapter/candidate-bank.json', 'utf8'));
  const questions = pack.editions.flatMap((edition) => edition.questions);
  assert.equal(pack.status, 'editorial-reviewed');
  assert.equal(pack.editions.length, 14);
  assert.equal(new Set(pack.editions.map((edition) => edition.themeId)).size, 14);
  assert.equal(questions.length, 70);
  assert.equal(new Set(questions.map((question) => question.id)).size, 70);
  assert.equal(new Set(questions.map((question) => question.book.title + '\0' + question.book.author)).size, 70);
  assert.equal(questions.filter((question) => question.type === 'quote_title').length, 21);
  assert.deepEqual([0, 1, 2, 3].map((choice) => questions.filter((question) => question.answerIndex === choice).length), [18, 18, 17, 17]);
  for (const edition of pack.editions) {
    assert.equal(edition.questions.length, 5);
    assert.equal(new Set(edition.questions.map((question) => question.answerIndex)).size, 4);
    assert.deepEqual(edition.questions.map((question) => question.difficulty), ['easy', 'easy', 'medium', 'medium', 'stretch']);
    for (const question of edition.questions) {
      assert.equal(new Set(question.options).size, 4);
      assert.equal(question.options[question.answerIndex], question.book.title);
      assert.match(question.book.sourceUrl, /^https:\/\//);
      if (question.type !== 'quote_title') continue;
      const proof = question.quoteProof;
      assert.equal(createHash('sha256').update(question.prompt).digest('hex'), proof.textSha256);
      assert.equal(question.book.sourceUrl, `https://github.com/standardebooks/${proof.repository}/blob/${proof.revision}/${proof.path}`);
      if (proof.paragraphText) assert.equal(proof.paragraphText.slice(proof.start, proof.start + proof.length), question.prompt);
      else assert.equal(bank.questions.find((candidate) => candidate.id === question.id)?.prompt, question.prompt);
    }
  }
});
