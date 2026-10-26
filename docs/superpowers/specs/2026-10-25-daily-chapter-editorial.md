# The Daily Chapter — editorial bank and launch fortnight

Status: source-backed editorial draft, 25 October 2026. The user selected Themed Edition in the design exploration. This pack contains draft content and a concept preview. The implementation below adds scheduled daily editions and editorial review; this exploration has not deployed the feature or scheduled production content.

## Format

- One official edition per day, shared by guests and members.
- Five questions and four distinct answer choices per question; score out of five, with no speed tiebreaker.
- Reveal answers and short explanations after submission. Completion advances a daily streak.
- Public website: illustrated invitation to the daily edition. Member Home: the same theme card above Around your shelf. Results: shareable score and the books behind the edition.
- Keep the card layout consistent. Each theme supplies its title, introduction, art motif and restrained colour accent.
- The theme selector in the concept preview is an editorial review control. Players receive one shared edition for the day.

## Editorial rules

- Rotate between genres, places, relationships, premises, storytelling, book culture, world literature and nonfiction.
- These 14 editions use 70 distinct answer books. A later edition may revisit a theme with new questions.
- Questions use independently worded descriptions, plus one short opening-line quotation. Use premise-level information and avoid ending reveals.
- The first two questions are intended to be approachable, the next two moderate, and the last a stretch. These difficulty estimates need reader playtesting.
- Every answer has a source link. Sources include publisher, author and estate pages, prize-organiser records, original digital texts and a publisher-supplied Google Books record.
- Source links establish the facts used in the questions. Quotation rights are assumed cleared on the project owner's instruction. This pack contains no downloaded covers.
- Production publication still needs a final editorial pass for ambiguity, difficulty, translation-specific clues and factual corrections. The JSON includes answer keys and must remain owner-side in a production integration.

## Quote sourcing

- Maintain a substantial verified quotation bank alongside original, fact-checked premise clues. Quote supply is a launch requirement. The current draft has 69 original clues and one direct quotation; it does not establish that this requirement has been met.
- For quotation questions, verify the exact wording in the book or an official author/publisher excerpt. Record the title, author, language, edition/ISBN, translator where relevant, chapter/page or source URL, and the basis for reuse. AI can help draft clues but must not invent or attribute quotations.
- Quotation reuse rights are assumed cleared for Atmyshelf app/web quizzes, as instructed by the project owner. Record this working assumption in the rights note; rights acquisition is not a pending task.
- The Hobbit opening-line question remains an editorial draft pending source-edition and content review. Credit quotations in the post-game explanation.

### Supply target and launch readiness

Planning target: 500 approved, quiz-ready quotations across at least 100 distinct books. At five quotations per edition, that is a theoretical ceiling of 100 daily editions before theme balance and repetition limits reduce the usable runway. A quotation count alone does not establish that a schedule can be filled.

- Build the classics foundation from original public-domain texts. [Project Gutenberg](https://www.gutenberg.org/policy/permission.html) and [Standard Ebooks](https://standardebooks.org/) provide source texts; verify the exact language and wording. For automated acquisition, follow the provider's supported download routes, including [Gutenberg's robot-access guidance](https://www.gutenberg.org/policy/robot_access.html).
- Build contemporary coverage from verified passages in the intended books and translations. Reuse rights are assumed cleared; exact wording and source identity still need checking.
- Keep discovery candidates, text-verified candidates and quiz-ready questions as separate counts. Only editorially approved questions count towards the ready reserve. Keep the rights assumption and source provenance with each quotation.
- Make a quotation quiz-ready by reviewing its theme fit, spoiler content, difficulty and answer choices. It must support a defensible single answer. Multiple snippets from one passage, exact duplicates and trivial variants do not create additional stock. Preserve wording; record and review any ellipsis or omission.
- Before scheduling a theme as quotation-led, prepare at least three complete five-question editions using at least ten distinct books across those editions and five distinct books within each edition. These are proposed launch thresholds, not implemented product configuration. The 40-theme bank remains a list of editorial possibilities until coverage is established.
- Retold myths needs sources that actually fit that theme. Public-domain myths alone do not supply quotations from contemporary retellings such as Circe or Ariadne. Source the intended books or adjust the planned edition's question mix; do not count substitute texts as coverage for a book they do not quote.
- Plan ready editions on a rolling calendar and monitor remaining approved, unused questions per theme. Replenish before the scheduled queue exhausts that reserve. Preserve usage history so repeated books and passages can be checked before scheduling.

Current readiness: a [candidate bank](../../daily-chapter/README.md) now contains 500 source-matched passages from 100 books, all unapproved. The combined roster has 164 target books; 64 launch titles have no quotation candidate in this bank. The 500 approved-quote target and per-theme ready reserves remain work to complete; quotation rights are assumed cleared and the remaining work is sourcing and editorial review.

### Recognisable book coverage

Book coverage is a separate launch requirement from the 500-quotation supply target. Prioritise one approved, quiz-ready quotation per target book before adding depth to books already covered.

- Define a curated target list of recognisable books across the launch themes, genres and languages, including contemporary favourites. Track each book as covered, editorial review pending or source needed.
- Measure coverage as distinct target books with at least one approved, quiz-ready quotation divided by all books on the target list. Show the counts overall and per theme. Multiple quotations from one book do not increase book coverage.
- Count coverage for the intended language and source edition. An approved English quotation does not establish coverage for a Portuguese-language edition.
- Set a launch coverage threshold against the target list. For example, 160 of 200 books establishes 80% coverage of that list; the example is not a claim about the current inventory or all well-known books.
- Check actual target-book coverage before putting a theme into regular rotation. Keep books still needing sources or editorial review in the denominator rather than removing them to improve the percentage.

Current readiness: the target-book list and its launch threshold still need to be established. No broad coverage of well-known books has been demonstrated.

## Theme performance

Requirement: retain each player's daily results so recurring themes build a useful reading history. The application stores these results; the standalone concept preview does not persist account metrics.

- Group editions by stable theme ID. `retold-myths` is the theme; Old myths, new voices is one edition title. Future titles and theme renames must preserve that history.
- Retain the first scored attempt per player and edition, with the published question version, question IDs, answers, server-graded results and start/completion times. Derive summaries from those results rather than storing only counters. Reuse existing quiz attempt and grading machinery when implementing this.
- For each theme, calculate editions completed, correct answers / scored questions, perfect editions, and consecutive perfect editions. Keep the overall daily completion streak separate from the sequence of appearances of a theme.
- Measure participation against the theme's live daily editions since the player first joined the daily challenge. Save publication windows and count a completion within its window as attendance. Show the denominator and start date; do not describe unseen releases from before that date as misses.
- Replays and archive practice do not replace the original daily result or restore attendance. Recovered submissions must not double-count an edition.
- Member history is saved to the account. Guest history can remain on the device, with verified results attached to an account on signup/sign-in without duplication; do not trust client-supplied scores.
- Show counts immediately and avoid inferring a lasting strength from a single quiz. These are personal theme insights, not a claim that performance on different themes is equally difficult.

Example personal result after six Retold myths editions:

> Retold myths · You have completed all 6 editions since you started. 28/30 correct · 4 perfect editions.

The result screen can say “Your third perfect Retold myths edition,” while the player's quiz history shows the full theme record. Attendance and accuracy remain separate so “never misses an edition” is not confused with “never misses an answer.”

## Implementation and editorial operation

- Web: `/daily` is public, with the daily invitation on the landing page and member Home. Native: `/daily` is public, with entry points from Home and sign-in. Editions reset at 00:00 UTC.
- Editor: `/admin/daily-chapter`, restricted by the existing `ADMIN_USER_ID`. Import this pack's JSON with a start date; it creates 70 target books, 70 unapproved questions and 14 private drafts. Reimporting preserves existing ids and review decisions.
- Add target books and quotation questions to the bank, record the exact edition and assumed rights, and approve only after reviewing wording, the source and the answer. The editor shows quote coverage overall and per theme, total approved quotations and unused stock. Original clues do not increase quotation coverage.
- Save an edition's date, theme and five question choices, then schedule the saved draft. Scheduling requires five approved questions from five distinct books assigned to the theme, and refuses previously scheduled questions. It freezes the questions, sources and book details. Future boards and answer keys remain private.
- The current day's scheduled edition is selected by the API date, without a background publishing job. An empty queue shows a waiting state. Published editions cannot be changed through the editor.
- Grading uses the existing shared quiz grader and stores final, idempotent results in the existing quiz play tables. Theme history, first-participation attendance and daily streaks are derived from saved results and publication dates. Scores have no speed ranking.
- A device-stored random guest identity recovers server-graded results. Signing in attaches that device's unclaimed results to the account, preserving an existing account result for the same edition. Answer drafts are saved locally. Account deletion removes the personal association from results.
- The inventory goals and target-book coverage threshold are editorial launch criteria, not an automated global publication gate. An editor can schedule an individually reviewed edition while assembling the bank; this does not establish that the full launch reserve is ready.
- The supplied launch pack remains a draft; the Hobbit quotation needs its source edition reviewed. Contemporary-book sourcing and question review remain editorial work. Rights are assumed cleared.

## Theme bank

| Family | Theme | Art motif | Tone |
|---|---|---|---|
| Genres | Cozy mysteries | window | sage |
| Genres | Space adventures | planet | blue |
| Genres | Romantic comedies | heart | rose |
| Genres | Gothic stories | window | plum |
| Genres | Historical fiction | column | ochre |
| Places | Bookshops & libraries | books | sage |
| Places | Island stories | island | blue |
| Places | Boarding schools | window | copper |
| Places | Train journeys | train | blue |
| Places | Small towns | houses | sage |
| Relationships | Found family | people | rose |
| Relationships | Unlikely friendships | people | sage |
| Relationships | Complicated siblings | people | plum |
| Relationships | Rivals & romance | heart | rose |
| Relationships | Across generations | portrait | ochre |
| Story premises | Time travel | clock | blue |
| Story premises | Secret identities | key | copper |
| Story premises | Disappearances | window | plum |
| Story premises | Strange invitations | envelope | rose |
| Story premises | Impossible places | door | sage |
| Storytelling | Opening lines | pen | copper |
| Storytelling | Letters & diaries | envelope | copper |
| Storytelling | Stories within stories | books | plum |
| Storytelling | Unreliable narrators | mirror | ink |
| Storytelling | One extraordinary day | sun | ochre |
| Book culture | Page to screen | film | copper |
| Book culture | Retold myths | column | ochre |
| Book culture | Pen names | pen | ink |
| Book culture | Debut novels | books | rose |
| Book culture | Books about books | books | sage |
| Around the world | Japanese fiction | window | blue |
| Around the world | Portuguese literature | tiles | blue |
| Around the world | Latin American voices | sun | rose |
| Around the world | African storytelling | tree | ochre |
| Around the world | Translated favourites | books | copper |
| True stories | Memoirs | portrait | copper |
| True stories | The natural world | leaf | sage |
| True stories | Scientific discoveries | planet | blue |
| True stories | Remarkable journeys | compass | ochre |
| True stories | Hidden histories | column | plum |

## Launch rotation

Day numbers are relative to launch. No publication dates have been scheduled.

| Day | Edition | Theme | Family |
|---|---|---|---|
| 1 | Between worlds | Impossible places | Story premises |
| 2 | Among the shelves | Bookshops & libraries | Places |
| 3 | From page to screen | Page to screen | Book culture |
| 4 | Remarkable lives | Memoirs | True stories |
| 5 | A world apart | Island stories | Places |
| 6 | A little chemistry | Romantic comedies | Genres |
| 7 | Wild and wonderful | The natural world | True stories |
| 8 | Old myths, new voices | Retold myths | Book culture |
| 9 | Stories from Portugal | Portuguese literature | Around the world |
| 10 | Out of time | Time travel | Story premises |
| 11 | Behind closed doors | Gothic stories | Genres |
| 12 | Dear reader | Letters & diaries | Storytelling |
| 13 | Beyond the stars | Space adventures | Genres |
| 14 | The people we find | Found family | Relationships |

## Complete editions

### Day 1: Between worlds

Unexpected doors. Impossible places. Five little journeys somewhere new.

**1. In a hole in the ground there lived a hobbit.**

- A. The Wind in the Willows
- B. The Hobbit
- C. The Lion, the Witch and the Wardrobe
- D. The Neverending Story

Answer: **B. The Hobbit** — J. R. R. Tolkien. Tolkien introduces the comfort of a hobbit-hole before Bilbo’s unexpected adventure. [Source](https://www.tolkienestate.com/Writing/)

**2. A woman enters a library whose books let her experience the lives she might have lived after making different choices.**

- A. The Starless Sea
- B. The Invisible Life of Addie LaRue
- C. The Book Thief
- D. The Midnight Library

Answer: **D. The Midnight Library** — Matt Haig. Nora Seed explores possible versions of her life through the books in the library. [Source](https://www.penguinrandomhouse.com/articles/the-midnight-library-by-matt-haig-excerpt/)

**3. A twelve-year-old travels with a satyr and a daughter of Athena to recover Zeus’s stolen lightning bolt.**

- A. The Lightning Thief
- B. Artemis Fowl
- C. The Red Pyramid
- D. Nevermoor

Answer: **A. The Lightning Thief** — Rick Riordan. Percy Jackson’s first quest centres on the theft of Zeus’s master bolt. [Source](https://rickriordan.com/book/the-lightning-thief/)

**4. An orc retires from adventuring and tries to open a coffee shop in a city unfamiliar with coffee.**

- A. The House in the Cerulean Sea
- B. Emily Wilde’s Encyclopaedia of Faeries
- C. Legends & Lattes
- D. The Very Secret Society of Irregular Witches

Answer: **C. Legends & Lattes** — Travis Baldree. Viv’s fresh start in Thune exchanges a life of fighting for coffee and community. [Source](https://us.macmillan.com/books/9781250889652/legendslattes/)

**5. A solitary man records a vast house of statues and ocean tides. His occasional visitor is known as the Other.**

- A. The Night Circus
- B. Piranesi
- C. The Ocean at the End of the Lane
- D. The Ten Thousand Doors of January

Answer: **B. Piranesi** — Susanna Clarke. The House and its tides are the world that Piranesi patiently documents. [Source](https://www.bloomsbury.com/uk/piranesi-9781526634108/)


### Day 2: Among the shelves

A place to begin again. A book to get lost in. Five stories for book people.

**1. After a breakup, Takako accepts a room above her uncle’s second-hand bookshop in Tokyo and begins discovering the pleasure of reading.**

- A. The Cat Who Saved Books
- B. Before the Coffee Gets Cold
- C. Days at the Morisaki Bookshop
- D. Welcome to the Hyunam-dong Bookshop

Answer: **C. Days at the Morisaki Bookshop** — Satoshi Yagisawa. Takako’s new beginning unfolds around her uncle Satoru’s shop in Jimbocho. [Source](https://www.bonnierbooks.co.uk/books/manilla-press/days-at-the-morisaki-bookshop/)

**2. A boy in Barcelona chooses a mysterious novel from the Cemetery of Forgotten Books and becomes fascinated by its author.**

- A. The Shadow of the Wind
- B. The Name of the Rose
- C. The Book Thief
- D. The Historian

Answer: **A. The Shadow of the Wind** — Carlos Ruiz Zafón. Daniel’s discovery of a novel by Julián Carax begins this Barcelona mystery. [Source](https://www.penguinrandomhouse.com/books/292766/shadow-of-the-wind-by-carlos-ruiz-zafon/9780143126393/readers-guide)

**3. A historical novel follows Belle da Costa Greene as she builds J. P. Morgan’s collection of rare books and manuscripts while concealing her racial identity.**

- A. The Paris Library
- B. The Lions of Fifth Avenue
- C. The Personal Assistant
- D. The Personal Librarian

Answer: **D. The Personal Librarian** — Marie Benedict and Victoria Christopher Murray. The novel draws on the life of the woman who helped create the Pierpont Morgan Library. [Source](https://www.penguinrandomhouse.com/books/623191/the-personal-librarian-a-gma-book-club-pick-by-marie-benedict-and-victoria-christopher-murray/9780593101544/)

**4. Florence Green opens a bookshop in an East Anglian coastal town and encounters polite but determined local opposition.**

- A. The Little Paris Bookshop
- B. The Bookshop
- C. The Bookshop on the Corner
- D. The Reading List

Answer: **B. The Bookshop** — Penelope Fitzgerald. Florence’s attempt to bring a bookshop to Hardborough disturbs the town’s established order. [Source](https://thebookerprizes.com/the-booker-library/books/the-bookshop)

**5. A bookseller named Loveday prefers books to people and has the opening lines of favourite novels tattooed on her skin.**

- A. The Lost Bookshop
- B. The Storied Life of A. J. Fikry
- C. The Lost for Words Bookshop
- D. The Last Bookshop in London

Answer: **C. The Lost for Words Bookshop** — Stephanie Butland. Loveday Cardew’s guarded life and love of books sit at the heart of this novel. [Source](https://us.macmillan.com/books/9781250124548/thelostforwordsbookshop/)


### Day 3: From page to screen

You may know the scene. Do you know the book behind it?

**1. A teenage girl volunteers in her younger sister’s place for a televised contest in which the participants fight to the death.**

- A. Divergent
- B. The Maze Runner
- C. Battle Royale
- D. The Hunger Games

Answer: **D. The Hunger Games** — Suzanne Collins. Katniss volunteers when Prim is selected at the reaping. [Source](https://www.scholastic.com/newsroom/all-news/press-release/the-hunger-games-by-suzanne-collins.html)

**2. Meg, Jo, Beth and Amy March grow up together, balancing family, ambitions and limited means during the American Civil War era.**

- A. Anne of Green Gables
- B. Little Women
- C. A Little Princess
- D. The Railway Children

Answer: **B. Little Women** — Louisa May Alcott. The March sisters’ differing hopes and temperaments shape this family story. [Source](https://www.panmacmillan.com/authors/louisa-may-alcott/little-women/9781509827770)

**3. An island theme park brings genetically recreated dinosaurs face to face with its first visitors, with disastrous consequences.**

- A. The Lost World
- B. The Andromeda Strain
- C. Jurassic Park
- D. Congo

Answer: **C. Jurassic Park** — Michael Crichton. Crichton turns a dinosaur attraction into a story about technology and control. [Source](https://www.penguinrandomhouse.com/books/33501/jurassic-park-by-michael-crichton/paperback/)

**4. Paul Atreides arrives on the desert planet Arrakis, where a precious spice makes the planet central to an interstellar struggle.**

- A. Dune
- B. Foundation
- C. Hyperion
- D. The Left Hand of Darkness

Answer: **A. Dune** — Frank Herbert. Arrakis, its spice and its people are central to Paul’s story. [Source](https://us.macmillan.com/books/9781427201447/dune/)

**5. Connell and Marianne move from the same Irish school into university, repeatedly finding and losing their connection to one another.**

- A. Conversations with Friends
- B. One Day
- C. Never Let Me Go
- D. Normal People

Answer: **D. Normal People** — Sally Rooney. Rooney follows the changing relationship between Marianne and Connell across several years. [Source](https://www.penguinrandomhouse.com/books/592625/normal-people-by-sally-rooney/9781984822185/)


### Day 4: Remarkable lives

Five lived experiences, told by the people who lived them.

**1. A former US First Lady reflects on her childhood on Chicago’s South Side and the experiences that eventually took her to the White House.**

- A. Becoming
- B. Living History
- C. My Life
- D. A Promised Land

Answer: **A. Becoming** — Michelle Obama. Michelle Obama traces the personal experiences behind her public life. [Source](https://www.penguinrandomhouse.com/books/562881/becoming-by-michelle-obama/9781524763152/)

**2. A South African comedian recounts growing up under apartheid as the child of a Black mother and a white father.**

- A. Long Walk to Freedom
- B. Dreams from My Father
- C. Born a Crime
- D. The Color of Water

Answer: **C. Born a Crime** — Trevor Noah. Noah’s memoir connects his childhood, his mother and the divisions of apartheid South Africa. [Source](https://www.penguinrandomhouse.com/books/537515/born-a-crime-by-trevor-noah/)

**3. Raised outside formal schooling in an isolated Idaho family, a young woman eventually earns a doctorate at Cambridge.**

- A. The Glass Castle
- B. Educated
- C. Unorthodox
- D. The Liars’ Club

Answer: **B. Educated** — Tara Westover. Westover describes her route into education and its effects on her family relationships. [Source](https://www.penguinrandomhouse.com/books/550168/educated-by-tara-westover/)

**4. Grieving her mother and facing upheaval in her life, a novice hiker sets off alone along the Pacific Crest Trail.**

- A. A Walk in the Woods
- B. Tracks
- C. Into the Wild
- D. Wild

Answer: **D. Wild** — Cheryl Strayed. Strayed’s solo hike becomes the framework for a memoir of grief and rebuilding. [Source](https://www.penguinrandomhouse.com/books/200313/wild-by-cheryl-strayed/9780307592736/)

**5. Anthony Bourdain takes readers behind restaurant doors into the heat, long shifts and unruly culture of commercial kitchens.**

- A. Kitchen Confidential
- B. Heat
- C. Blood, Bones & Butter
- D. The Apprentice

Answer: **A. Kitchen Confidential** — Anthony Bourdain. Bourdain writes about the working life and culture of professional cooks. [Source](https://www.bloomsbury.com/us/kitchen-confidential-9781582340821/)


### Day 5: A world apart

Remote shores, hidden histories and lives surrounded by water.

**1. Jim Hawkins finds a pirate’s map and sails on the Hispaniola, whose crew includes the persuasive Long John Silver.**

- A. Kidnapped
- B. Treasure Island
- C. Captain Blood
- D. Swallows and Amazons

Answer: **B. Treasure Island** — Robert Louis Stevenson. Jim’s map leads him into an expedition for Captain Flint’s buried treasure. [Source](https://www.gutenberg.org/ebooks/120)

**2. A shipwrecked sailor builds a new life on a remote island, finding ways to feed, shelter and occupy himself over many years.**

- A. The Swiss Family Robinson
- B. Gulliver’s Travels
- C. The Coral Island
- D. Robinson Crusoe

Answer: **D. Robinson Crusoe** — Daniel Defoe. Defoe’s castaway narrates the practical and emotional challenges of island life. [Source](https://www.gutenberg.org/ebooks/521)

**3. Ten strangers accept invitations to an isolated island, where their absent hosts and a series of deaths turn the visit into a trap.**

- A. And Then There Were None
- B. The Guest List
- C. The Hunting Party
- D. The Woman in Cabin 10

Answer: **A. And Then There Were None** — Agatha Christie. Soldier Island cuts Christie’s guests off from outside help. [Source](https://www.agathachristie.com/stories/and-then-there-were-none)

**4. A shipwreck survivor reaches an island where a scientist is experimenting with transforming animals into humanlike beings.**

- A. The Invisible Man
- B. The Time Machine
- C. The Island of Doctor Moreau
- D. The Chrysalids

Answer: **C. The Island of Doctor Moreau** — H. G. Wells. Edward Prendick encounters the consequences of Moreau’s experiments. [Source](https://www.gutenberg.org/ebooks/159)

**5. A Greek Cypriot and a Turkish Cypriot fall in love in a taverna whose fig tree bears witness to the island’s divided history.**

- A. The Beekeeper of Aleppo
- B. The Island of Missing Trees
- C. Small Island
- D. The Island

Answer: **B. The Island of Missing Trees** — Elif Shafak. Kostas, Defne and the fig tree connect personal memory with the history of Cyprus. [Source](https://www.bloomsbury.com/us/island-of-missing-trees-9781635578591/)


### Day 6: A little chemistry

Awkward arrangements, familiar rivals and feelings that complicate everything.

**1. The son of an American president and a British prince turn a public rivalry into a much more private relationship.**

- A. Boyfriend Material
- B. One Last Stop
- C. Red, White & Royal Blue
- D. Playing the Palace

Answer: **C. Red, White & Royal Blue** — Casey McQuiston. Alex Claremont-Diaz and Prince Henry are the pair at the centre of this romance. [Source](https://www.caseymcquiston.com/red-white-and-royal-blue)

**2. Tiffy and Leon share a one-bedroom flat and the same bed at different times, leaving notes before they have ever met.**

- A. The Flatshare
- B. The Switch
- C. The Roommate
- D. The Wake-Up Call

Answer: **A. The Flatshare** — Beth O’Leary. Their opposite working hours make an unusual flat-sharing arrangement possible. [Source](https://www.betholearyauthor.com/the-flatshare/)

**3. A biology PhD student starts a fake relationship with a famously difficult professor after an impulsive kiss.**

- A. Love on the Brain
- B. The Kiss Quotient
- C. The Rosie Project
- D. The Love Hypothesis

Answer: **D. The Love Hypothesis** — Ali Hazelwood. Olive Smith and Adam Carlsen’s pretend relationship complicates their academic lives. [Source](https://www.penguinrandomhouse.com/books/673764/the-love-hypothesis-prime-tie-in-by-ali-hazelwood-with-a-foreword-by-lili-reinhart/)

**4. Literary agent Nora visits a small North Carolina town with her sister, only to keep encountering editor Charlie Lastra.**

- A. Beach Read
- B. Book Lovers
- C. The Bookish Life of Nina Hill
- D. People We Meet on Vacation

Answer: **B. Book Lovers** — Emily Henry. Nora’s trip to Sunshine Falls repeatedly brings her together with a familiar editor. [Source](https://www.penguinrandomhouse.com/books/670293/book-lovers-by-emily-henry/9780593334836/)

**5. Lucy Hutton and Joshua Templeman share an office at a publishing company and compete for the same promotion.**

- A. The Spanish Love Deception
- B. The Unhoneymooners
- C. The Hating Game
- D. The Ex Talk

Answer: **C. The Hating Game** — Sally Thorne. Lucy and Joshua’s workplace rivalry drives this romantic comedy. [Source](https://www.sallythorneauthor.com/the-hating-game)


### Day 7: Wild and wonderful

Fungi, forests, feathers and the lives unfolding around us.

**1. A botanist brings plant science into conversation with Indigenous knowledge, gratitude and reciprocity with the living world.**

- A. The Genius of Birds
- B. The Overstory
- C. Pilgrim at Tinker Creek
- D. Braiding Sweetgrass

Answer: **D. Braiding Sweetgrass** — Robin Wall Kimmerer. Kimmerer combines her botanical training with knowledge from her Indigenous heritage. [Source](https://milkweed.org/braiding-sweetgrass)

**2. A biologist explores fungi, from yeasts and lichens to networks that help shape ecosystems.**

- A. Other Minds
- B. Entangled Life
- C. The Hidden Life of Trees
- D. The Tangled Tree

Answer: **B. Entangled Life** — Merlin Sheldrake. Sheldrake centres fungi and their relationships with other forms of life. [Source](https://www.merlinsheldrake.com/entangled-life)

**3. After her father’s death, a writer turns to training a goshawk named Mabel.**

- A. The Goshawk
- B. Vesper Flights
- C. H Is for Hawk
- D. The Peregrine

Answer: **C. H Is for Hawk** — Helen Macdonald. Macdonald intertwines grief, falconry and her relationship with Mabel. [Source](https://groveatlantic.com/book/h-is-for-hawk/)

**4. An author gets to know octopuses at an aquarium while exploring their behaviour and the possibilities of animal consciousness.**

- A. The Soul of an Octopus
- B. Remarkably Bright Creatures
- C. The Secret Life of Lobsters
- D. The Sea Around Us

Answer: **A. The Soul of an Octopus** — Sy Montgomery. Montgomery’s encounters with octopuses guide this work of nonfiction. [Source](https://symontgomery.com/soul-of-an-octopus/)

**5. A forester invites readers to consider the relationships, survival strategies and social lives of trees.**

- A. The Forest Unseen
- B. The Wild Trees
- C. The Living Mountain
- D. The Hidden Life of Trees

Answer: **D. The Hidden Life of Trees** — Peter Wohlleben. Wohlleben draws on his forestry experience to examine life in the forest. [Source](https://www.peterwohllebenbooks.com/the-hidden-life-of-trees)


### Day 8: Old myths, new voices

Familiar legends, seen through the people at their edges.

**1. A daughter of Helios develops a gift for witchcraft and makes a life on the island of Aeaea.**

- A. Circe
- B. Ariadne
- C. Atalanta
- D. Clytemnestra

Answer: **A. Circe** — Madeline Miller. Miller gives the witch encountered in the Odyssey a story of her own. [Source](https://madelinemiller.com/circe/)

**2. Patroclus tells the story of his bond with Achilles as their lives move towards the Trojan War.**

- A. The Silence of the Girls
- B. The Iliad
- C. The Song of Achilles
- D. The King Must Die

Answer: **C. The Song of Achilles** — Madeline Miller. Patroclus’s perspective centres the relationship behind Achilles’s legendary reputation. [Source](https://madelinemiller.com/the-song-of-achilles/)

**3. A princess of Crete helps Theseus face the Minotaur, setting in motion a life beyond the labyrinth.**

- A. Elektra
- B. Ariadne
- C. Stone Blind
- D. Daughters of Sparta

Answer: **B. Ariadne** — Jennifer Saint. Saint revisits the myth through Ariadne and the women around her. [Source](https://us.macmillan.com/books/9781250773579/ariadne/)

**4. Odysseus’s wife and her twelve maids revisit their part in the story usually told about his long journey home.**

- A. A Thousand Ships
- B. The Women of Troy
- C. The Children of Jocasta
- D. The Penelopiad

Answer: **D. The Penelopiad** — Margaret Atwood. Atwood gives Penelope and the maids a chance to question the familiar account. [Source](https://margaretatwood.ca/books/the-penelopiad/)

**5. A woman who barely speaks in Virgil’s Aeneid becomes the narrator of her own life and her connection to Aeneas.**

- A. Lavinia
- B. The Firebrand
- C. The Red Tent
- D. The Palace of Illusions

Answer: **A. Lavinia** — Ursula K. Le Guin. Le Guin develops the voice of the Latin princess from Virgil’s epic. [Source](https://www.ursulakleguin.com/lavinia)


### Day 9: Stories from Portugal

Five voices and stories with Portuguese roots.

**1. An unexplained epidemic of white blindness spreads through a city, leading the authorities to quarantine the first affected people.**

- A. Seeing
- B. Blindness
- C. The Plague
- D. The Death of Ivan Ilyich

Answer: **B. Blindness** — José Saramago. Saramago uses a sudden loss of sight to explore how people behave towards one another. [Source](https://www.josesaramago.org/en/book/blindness-essay/)

**2. Fragments attributed to Lisbon bookkeeper Bernardo Soares turn ordinary working life into reflections on dreams, identity and existence.**

- A. The Book of Illusions
- B. The Notebooks of Malte Laurids Brigge
- C. The Year of the Death of Ricardo Reis
- D. The Book of Disquiet

Answer: **D. The Book of Disquiet** — Fernando Pessoa. Pessoa’s fragmentary work is closely associated with the voice of Bernardo Soares. [Source](https://wwnorton.co.uk/books/9780811226936-the-book-of-disquiet)

**3. The fortunes of a wealthy Portuguese family, including the young doctor Carlos da Maia, unfold against nineteenth-century Lisbon society.**

- A. The Maias
- B. The Crime of Father Amaro
- C. Cousin Bazilio
- D. The Relic

Answer: **A. The Maias** — Eça de Queirós. The Maia family gives Queirós a way to examine several generations and their social world. [Source](https://www.ndbooks.com/book/the-maias/)

**4. Fifteen-year-old Rui leaves Angola with his family in 1975 and starts an uncertain new life in a hotel near Lisbon.**

- A. Eliete
- B. The Piano Cemetery
- C. The Return
- D. South of Nowhere

Answer: **C. The Return** — Dulce Maria Cardoso. Cardoso follows displacement and family life through Rui’s adolescent perspective. [Source](https://www.hachette.co.uk/titles/dulce-maria-cardoso/the-return/9780857054357/)

**5. A woman revisits the events surrounding her marriage to a Portuguese military officer in Mozambique, questioning how that past has been told.**

- A. The Wind Whistling in the Cranes
- B. The Murmuring Coast
- C. The Land at the End of the World
- D. The Painter of Birds

Answer: **B. The Murmuring Coast** — Lídia Jorge. Jorge returns to a colonial wartime setting through Eva Lopo’s recollections. [Source](https://books.google.com/books/about/The_Murmuring_Coast.html?id=85YrnoxfgC8C)


### Day 10: Out of time

A café, a doorway, a letter. Five ways to slip out of the present.

**1. A small Tokyo café lets its visitors travel into the past, provided they follow strict rules and return before their drink cools.**

- A. The Full Moon Coffee Shop
- B. The Travelling Cat Chronicles
- C. Before the Coffee Gets Cold
- D. The Kamogawa Food Detectives

Answer: **C. Before the Coffee Gets Cold** — Toshikazu Kawaguchi. The café’s time-travel offer is shaped by a very particular deadline. [Source](https://www.panmacmillan.com/authors/toshikazu-kawaguchi/before-the-coffee-gets-cold/9781529029598)

**2. Henry’s involuntary journeys through time make his relationship with artist Clare unfold in an unusual order.**

- A. The Time Traveler’s Wife
- B. The First Fifteen Lives of Harry August
- C. Life After Life
- D. How to Stop Time

Answer: **A. The Time Traveler’s Wife** — Audrey Niffenegger. Henry and Clare experience their shared life from different points in time. [Source](https://www.penguin.co.uk/books/358096/the-time-travelers-wife-by-niffenegger-audrey/9781529996272)

**3. An English teacher discovers a passage into the past and takes on the task of preventing John F. Kennedy’s assassination.**

- A. The Dead Zone
- B. Replay
- C. Time and Again
- D. 11/22/63

Answer: **D. 11/22/63** — Stephen King. Jake Epping’s mission gives King’s time-travel novel its date-shaped title. [Source](https://stephenking.com/works/novel/11-22-63.html)

**4. Dana, a Black writer living in the 1970s, is repeatedly pulled into the world of a plantation in pre-Civil War Maryland.**

- A. Parable of the Sower
- B. Kindred
- C. Beloved
- D. The Water Dancer

Answer: **B. Kindred** — Octavia E. Butler. Butler connects Dana’s present to the lives and power structures of the American past. [Source](https://www.octaviabutler.com/kindred)

**5. Two agents on opposing sides of a war across possible futures begin leaving each other letters.**

- A. The Future of Another Timeline
- B. The Psychology of Time Travel
- C. This Is How You Lose the Time War
- D. The Rise and Fall of D.O.D.O.

Answer: **C. This Is How You Lose the Time War** — Amal El-Mohtar and Max Gladstone. The correspondence between Red and Blue becomes the centre of this novella. [Source](https://www.simonandschuster.com/books/This-Is-How-You-Lose-the-Time-War/Amal-El-Mohtar/9781534430990)


### Day 11: Behind closed doors

Strange houses, uneasy visitors and the things left unspoken.

**1. A young English solicitor visits a Transylvanian count whose plans will eventually bring a vampire to England.**

- A. Carmilla
- B. The Vampyre
- C. Interview with the Vampire
- D. Dracula

Answer: **D. Dracula** — Bram Stoker. Jonathan Harker’s journey to the Count’s castle begins the novel’s gathering of journals and letters. [Source](https://www.gutenberg.org/ebooks/345)

**2. A young scientist creates a living being and recoils from the creature he has brought into the world.**

- A. The Strange Case of Dr Jekyll and Mr Hyde
- B. Frankenstein
- C. The Picture of Dorian Gray
- D. The Invisible Man

Answer: **B. Frankenstein** — Mary Shelley. Victor Frankenstein’s creation and rejection of the creature drive Shelley’s novel. [Source](https://www.gutenberg.org/ebooks/84)

**3. A new bride arrives at Manderley and finds her married life overshadowed by the memory of her husband’s first wife.**

- A. My Cousin Rachel
- B. Jane Eyre
- C. Rebecca
- D. The Thirteenth Tale

Answer: **C. Rebecca** — Daphne du Maurier. The unnamed second Mrs de Winter encounters a household still shaped by Rebecca. [Source](https://www.dumaurier.org/menu_page.php?id=102)

**4. Noemí travels to an isolated English-style mansion in Mexico after receiving a disturbing letter from her newly married cousin.**

- A. Mexican Gothic
- B. The Hacienda
- C. The Silent Companions
- D. The Death of Jane Lawrence

Answer: **A. Mexican Gothic** — Silvia Moreno-Garcia. Noemí’s visit to High Place begins with concern for her cousin Catalina. [Source](https://www.penguinrandomhouse.com/books/577068/mexican-gothic-by-silvia-moreno-garcia/9780525620785/)

**5. Merricat, her sister Constance and their uncle live apart from a hostile village after a tragedy in the Blackwood family.**

- A. The Haunting of Hill House
- B. The Little Stranger
- C. The Woman in Black
- D. We Have Always Lived in the Castle

Answer: **D. We Have Always Lived in the Castle** — Shirley Jackson. The isolated Blackwood household is the setting for Merricat’s unsettling account. [Source](https://www.penguinrandomhouse.com/books/541341/we-have-always-lived-in-the-castle-by-shirley-jackson/)


### Day 12: Dear reader

Private pages, distant friends and stories told one entry at a time.

**1. A Jewish teenager records daily life while hiding with her family in Amsterdam during the Nazi occupation.**

- A. The Diary of a Young Girl
- B. I Am Malala
- C. The Hiding Place
- D. Zlata’s Diary

Answer: **A. The Diary of a Young Girl** — Anne Frank. Anne Frank’s diary records the experiences of a young person living in hiding. [Source](https://www.randomhousebooks.com/books/55694/)

**2. Charlie tells an unnamed friend about his first year of high school through letters, as new friendships draw him out of the sidelines.**

- A. The Catcher in the Rye
- B. Looking for Alaska
- C. The Perks of Being a Wallflower
- D. Aristotle and Dante Discover the Secrets of the Universe

Answer: **C. The Perks of Being a Wallflower** — Stephen Chbosky. Charlie’s letters give the novel its intimate account of adolescence and friendship. [Source](https://www.simonandschuster.com/books/The-Perks-of-Being-a-Wallflower/Stephen-Chbosky/9781451696196)

**3. After the Second World War, writer Juliet Ashton exchanges letters with members of a book club formed on occupied Guernsey.**

- A. The Jane Austen Society
- B. The Guernsey Literary and Potato Peel Pie Society
- C. The Reading List
- D. The Chilbury Ladies’ Choir

Answer: **B. The Guernsey Literary and Potato Peel Pie Society** — Mary Ann Shaffer and Annie Barrows. The letters bring Juliet into contact with an island community and its wartime history. [Source](https://www.penguinrandomhouse.com/books/164594/the-guernsey-literary-and-potato-peel-pie-society-by-mary-ann-shaffer-and-annie-barrows/)

**4. Celie’s letters to God and to her sister Nettie trace her life in the American South and her search for independence.**

- A. Their Eyes Were Watching God
- B. The Bluest Eye
- C. I Know Why the Caged Bird Sings
- D. The Color Purple

Answer: **D. The Color Purple** — Alice Walker. Walker uses Celie’s letters to centre her voice and changing relationships. [Source](https://www.hachette.co.uk/titles/alice-walker/the-color-purple/9781409139263/)

**5. London clerk Charles Pooter records domestic mishaps, social embarrassments and his hopes of being taken seriously.**

- A. The Diary of a Nobody
- B. Three Men in a Boat
- C. The Diary of a Provincial Lady
- D. Cold Comfort Farm

Answer: **A. The Diary of a Nobody** — George Grossmith and Weedon Grossmith. The Grossmiths turn Pooter’s daily entries into a comedy of ordinary Victorian life. [Source](https://www.gutenberg.org/ebooks/1026)


### Day 13: Beyond the stars

Stranded astronauts, unlikely crews and journeys far from home.

**1. Arthur Dent escapes Earth moments before its demolition and travels through space with his friend Ford Prefect.**

- A. The Restaurant at the End of the Universe
- B. The Hitchhiker’s Guide to the Galaxy
- C. Good Omens
- D. The Sirens of Titan

Answer: **B. The Hitchhiker’s Guide to the Galaxy** — Douglas Adams. Arthur’s rescue begins an absurd journey through the galaxy. [Source](https://www.penguinrandomhouse.com/books/671/the-hitchhikers-guide-to-the-galaxy-25th-anniversary-edition-by-douglas-adams/)

**2. Astronaut Mark Watney is left behind on Mars and relies on his scientific training to stay alive.**

- A. Artemis
- B. Red Mars
- C. Seveneves
- D. The Martian

Answer: **D. The Martian** — Andy Weir. Watney’s improvised survival efforts centre the story on Mars. [Source](https://www.penguinrandomhouse.com/books/818980/the-martian-deluxe-edition-by-andy-weir/)

**3. A man wakes aboard a spacecraft with almost no memory and gradually discovers that his mission could save humanity.**

- A. Project Hail Mary
- B. Rendezvous with Rama
- C. Solaris
- D. Tau Zero

Answer: **A. Project Hail Mary** — Andy Weir. Ryland Grace must recover the purpose of his mission while solving its scientific puzzle. [Source](https://images.penguinrandomhouse.com/promo_image/9780593135204_8306.pdf)

**4. Rosemary joins the Wayfarer, a wormhole-building ship whose crew brings together people from several species.**

- A. A Memory Called Empire
- B. The Galaxy, and the Ground Within
- C. The Long Way to a Small, Angry Planet
- D. A Psalm for the Wild-Built

Answer: **C. The Long Way to a Small, Angry Planet** — Becky Chambers. The Wayfarer’s working life and its varied crew shape Chambers’s space adventure. [Source](https://www.hachette.co.uk/titles/becky-chambers/the-long-way-to-a-small-angry-planet/9781473619814/)

**5. Breq was once the intelligence of a vast starship. Now confined to one human body, she pursues a mission of revenge.**

- A. A Memory Called Empire
- B. Ancillary Justice
- C. All Systems Red
- D. Translation State

Answer: **B. Ancillary Justice** — Ann Leckie. Leckie’s novel follows the surviving fragment of the starship Justice of Toren. [Source](https://annleckie.com/novel/ancillary-justice/)


### Day 14: The people we find

A household, a neighbourhood, a circle. Five ways to belong.

**1. Caseworker Linus Baker is sent to inspect an island home where six unusually magical children live.**

- A. Miss Peregrine’s Home for Peculiar Children
- B. The Very Secret Society of Irregular Witches
- C. The House in the Cerulean Sea
- D. The House of the Spirits

Answer: **C. The House in the Cerulean Sea** — TJ Klune. Linus’s assignment brings him into the household run by Arthur Parnassus. [Source](https://us.macmillan.com/books/9781250217288/thehouseintheceruleansea/)

**2. Mika Moon accepts an invitation to teach three young witches who live together at a place called Nowhere House.**

- A. The Very Secret Society of Irregular Witches
- B. The Ex Hex
- C. The Witch’s Heart
- D. Garden Spells

Answer: **A. The Very Secret Society of Irregular Witches** — Sangu Mandanna. The invitation challenges Mika’s expectation that witches must live separately. [Source](https://www.penguinrandomhouse.com/books/696866/the-very-secret-society-of-irregular-witches-by-sangu-mandanna/)

**3. A gruff widower’s strictly ordered days are disrupted when Parvaneh and her family move in next door.**

- A. The Unlikely Pilgrimage of Harold Fry
- B. Eleanor Oliphant Is Completely Fine
- C. The Authenticity Project
- D. A Man Called Ove

Answer: **D. A Man Called Ove** — Fredrik Backman. Ove’s encounters with his neighbours gradually reveal the person behind his gruff exterior. [Source](https://www.simonandschuster.com/books/A-Man-Called-Ove/Fredrik-Backman/9781476738024)

**4. Four residents of a retirement village meet to discuss unsolved crimes, then find themselves investigating a fresh murder.**

- A. The Marlow Murder Club
- B. The Thursday Murder Club
- C. Vera Wong’s Unsolicited Advice for Murderers
- D. The No. 1 Ladies’ Detective Agency

Answer: **B. The Thursday Murder Club** — Richard Osman. The friends’ weekly meetings become unexpectedly practical when a real case arrives. [Source](https://global.penguinrandomhouse.com/announcements/richard-osman-to-discuss-his-new-mystery-novel-via-facebook-live-9-20/)

**5. Widowed aquarium cleaner Tova forms an unlikely friendship with Marcellus, a giant Pacific octopus.**

- A. The Soul of an Octopus
- B. How the Penguins Saved Veronica
- C. Remarkably Bright Creatures
- D. The Travelling Cat Chronicles

Answer: **C. Remarkably Bright Creatures** — Shelby Van Pelt. Tova and Marcellus’s connection brings companionship and new possibilities into her life. [Source](https://shelbyvanpelt.com/books/remarkably-bright-creatures/)
