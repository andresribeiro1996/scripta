# Reviewed launch fortnight

Ready for editor import: 14 editions, 70 distinct books, 21 quotation questions and 49 original premise clues. All 14 launch themes remain represented, including contemporary myth retellings and Portuguese literature. Rights are assumed cleared on the project owner's instruction.

The source pass checked exact quote wording and locations, the facts used in clues, plausible distinct answers, theme fit and premise-level spoilers. Generic snippets were replaced with passages identifiable through their characters, setting or recognizable wording. Difficulty labels are editorial estimates; no reader playtest or difficulty calibration has been completed.

## Queue

Days are relative to the start date chosen in the editor. Each edition contains five different books. No answer book repeats during the fortnight.

| Day | Theme | Edition | Quotations / clues |
|---|---|---|---:|
| 1 | Impossible places | Between worlds | 5 / 0 |
| 2 | Bookshops & libraries | Among the shelves | 0 / 5 |
| 3 | Page to screen | From page to screen | 5 / 0 |
| 4 | Memoirs | Remarkable lives | 0 / 5 |
| 5 | Island stories | A world apart | 1 / 4 |
| 6 | Romantic comedies | A little chemistry | 1 / 4 |
| 7 | The natural world | Wild and wonderful | 0 / 5 |
| 8 | Retold myths | Old myths, new voices | 0 / 5 |
| 9 | Portuguese literature | Stories from Portugal | 0 / 5 |
| 10 | Time travel | Out of time | 1 / 4 |
| 11 | Gothic stories | Behind closed doors | 5 / 0 |
| 12 | Letters & diaries | Dear reader | 1 / 4 |
| 13 | Space adventures | Beyond the stars | 0 / 5 |
| 14 | Found family | The people we find | 2 / 3 |

## Import and schedule

1. Open `/admin/daily-chapter` as the configured editor.
2. Choose the first edition's UTC date under **Import an editorial pack**. Use an unoccupied run of 14 dates, starting today or later.
3. Upload `docs/daily-chapter/launch-fortnight.json`. Its explicit `editorial-reviewed` status imports the questions as approved under the authenticated editor's account. The 14 dated editions remain private drafts.
4. Inspect each saved edition in **Edition calendar**, then select **Schedule saved edition**. Scheduling freezes the reviewed questions. The edition becomes public at 00:00 UTC on its date.

The same importer still treats the original exploration pack as unapproved drafts. Reviewed imports retain source-edition details and rights notes, and validate the whole pack before writing. A malformed answer, missing quotation edition, occupied date or conflicting identity imports nothing. Approval does not schedule or expose an edition.

Importing the 500-candidate bank first is supported. Sixteen launch quotations reuse the corresponding candidate ids; reviewed imports promote those unapproved rows and install the curated choices. Five additional quotations use more identifiable source excerpts. Together the bank and launch pack contain 554 distinct questions, of which 70 are approved by the reviewed import. An already approved matching question retains subsequent editorial changes when the pack is reimported. A conflicting question id fails rather than replacing other content. Previously scheduled questions cannot be published again.

## Review evidence

The JSON contains the full questions, explanations, four choices, correct answers, source links and editorial notes. Quotation proofs retain the immutable source revision, paragraph location, source-file hash and normalized-text hash. For an excerpt within a longer paragraph, the proof also records the original paragraph and exact character range. Words inside the excerpt are unchanged. Translations are identified in the source-edition field.

Clues use author, estate, publisher and archive descriptions. The pass also replaced unusable source links, including an author page containing unrelated material, with the corresponding publisher page. Short explanations identify the relevant character or setting without revealing endings. All clues are in English, including the Portuguese-literature edition; this does not establish Portuguese-language quotation coverage.

The correct answer appears in each position 17 or 18 times over the 70 questions, and all four positions occur within each edition. This prevents a systematic answer-position bias; it does not establish equal question difficulty.

The raw 500-candidate file stays unapproved and its coverage report continues to describe that file alone. The reviewed launch is a separate deliverable. The rest of the quotation reserve and coverage gaps can be expanded alongside this initial queue.

Content remains in repository files until imported. No production editions have been scheduled or deployed by this preparation.
