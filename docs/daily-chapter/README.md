# Daily Chapter content supply

The [reviewed launch fortnight](launch-fortnight.md) is ready for editor import: 14 editions, 70 distinct books, 21 quotations and 49 original clues. Use `launch-fortnight.json` in **Import an editorial pack** to retain its editorial approval; editions still need scheduling.

`candidate-bank.json` contains 500 unapproved quotation questions from 100 Standard Ebooks source editions, plus the 70-book launch roster with six overlapping books merged. There are 164 target books. The bank includes source proofs, not publication dates. [Coverage and remaining gaps](coverage.md) distinguish candidates from the approved reserve.

In `/admin/daily-chapter`, use **Import a candidate bank** and select this JSON file. Importing adds books and draft questions, merges theme tags for matching book ids, and preserves existing question reviews. It creates no editions and requires editor access. The separate **Import an editorial pack** control imports the original 14 edition drafts and needs a start date.

The passages are whole paragraphs selected mechanically from source body text. All 500 were checked against the downloaded fixed-revision XHTML: exact wording after whitespace normalization, paragraph position, source file SHA-256 and metadata SHA-256. This verifies transcription; question suitability still needs editorial review. The source-language variant and translators are recorded independently of the target's `en` language.

Quotation reuse rights are assumed cleared for Atmyshelf app/web quizzes, as instructed by the project owner. This is the working project assumption recorded in each candidate's rights note. Before approving a question, review wording, source accuracy, ambiguity, distractors, language, spoilers, explanation and theme suitability. Draft book tags are starting points. Five paragraphs from an `opening-lines` book are not five opening lines. Only approved questions count towards coverage and the usable reserve. Prioritise a suitable first quotation for each target book before adding more depth.

The source set is weighted towards English-language classics. It does not meet contemporary-book coverage or the planned reserve for all 40 themes. Modern myth retellings and Portuguese editions still need their own verified passages. Rights acquisition is not a pending project task.

To reproduce from the repository root, with Python 3 and the workspace Node dependencies installed:

```sh
npm run build --workspace @scripta/shared
python3 scripts/daily-chapter-sources.py docs/daily-chapter/sources.json /tmp/atmyshelf-daily-source-cache /tmp/atmyshelf-daily-passages.json
node scripts/build-daily-chapter-bank.mjs /tmp/atmyshelf-daily-passages.json
node --test scripts/daily-chapter-bank.test.mjs
```

The extractor reads pinned public GitHub source files with three concurrent workers and caches them outside the repository. It does not download covers or store full books in Git. A fetch or parse failure stops the build. Question ids derive from the source repository and normalized passage; the existing shared quiz generator supplies reproducible answer choices. Editing the source manifest is an editorial action; generated questions remain drafts.

Each source record in the bank lists its immutable revision, metadata hash, translators and five paragraph proofs. Each proof names the question, file path, source-file hash, paragraph index among all body paragraphs, nearest section id and normalized-text hash. The source URL opens that exact revision. Keep these records with any subsequent editorial review.
