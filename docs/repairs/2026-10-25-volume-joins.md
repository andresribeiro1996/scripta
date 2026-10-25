# Volume joins repair — 2026-10-25

Spec: `docs/superpowers/specs/2026-10-25-volume-joins-and-search-ranking-design.md` (Part 1). Undo file: `docs/repairs/2026-10-25-volume-joins-undo.json`.

## Source

`undo-series-merges.mjs --guarded` ran read-only on production on 2026-10-25, with PR #365's code bundled into `/tmp` on the container:
- 5,522 active code/Jev joins checked;
- 20 skipped (their moved editions are no longer under the target);
- 95 flagged: 12 never, 83 review.

Claude decided each flagged join by the user's rules:
- split volumes stay apart;
- a volume never sits inside its series or omnibus;
- a genuine one-volume or omnibus translation stays.

The result is 57 undone and 38 kept.

## Beyond the flagged list

- **Undo 423 and 424** ("Os Pilares da Terra – Volume I", code joins). The guard let them through because Volume I matched *The Pillars of the Earth*'s own series position 1. They are split volumes like 422 and 650.
- **Undo 23431,** the title-key fold of the Galician "A irmandade do anel" (9788483026823) into the omnibus. It belongs with Fellowship. Once undone, the daily title-key fold moves it there.
- **Undo 671,** a **manual** merge of "O Conde de Monte Cristo II" (9789896417499, OL24667894W) into the whole novel. It is a split volume. Manual merges stay protected from an ordinary `undo` list, so this one is named in the file's explicit `undoManual` list.
- **Detach 9789896417338,** "Os Miseráveis (volume 2 de 2)". It reached the whole novel through a title-key fold. Its title key equals the whole novel's, so an undo would be folded straight back. A detach also blocks title grouping.
- **Detach 9789896410353 and 9789897849831,** part 2 of "O Romance do Genji" and of "Lore Olympus: Volume 1". Brackets drop out of title keys, so each part 1 and part 2 share one key. Without the detach, the daily title-key fold would merge each restored pair back into one work.
- **Manual merge** of `e2ae6929…` "A Irmandade do Anel - O Senhor dos Anéis - Parte I" (Planeta, 9789897774355) into the restored Fellowship (`a5bf1a13…`, OL27513W). It is the same book as the Planeta "A irmandade do anel" (9789897773921).
- **Manual merge** of the restored "Mundos paralelos" (`469f87b2…`) into *Northern Lights* (`5aff62cf…`, OL111464W). Undone works carry a `manual` null judgment, so no job would join it on its own.
- **No home work in the catalog** for the other single novels taken out of omnibuses: "Meio sol amarelo", "A cor do hibisco", "Álbum de família", the Grumpy Monkey sequels and the graphic novels. They stay as Portuguese works of their own. "Anúncio de um crime" carries its own key (OL471771W), so it comes back as *A Murder is Announced* itself.

## The Lord of the Rings

After the undo:
- **Fellowship** (`a5bf1a13…`, OL27513W) gets back three editions: Europa-América 9789721041028, Contemporânea #51 9789721049789 and Planeta 9789897773921. The English *The Fellowship of the Ring* (9781500410223, OL27513W) comes back with them, by its Open Library key. The Galician edition follows through 23431, and the Planeta "Parte I" through the manual merge.
- **Two Towers** (`1e34a680…`, OL27479W) gets back Europa-America 9789721041448 and Planeta 9789897774706.
- **"O senhor dos anéis"** (`493a9f7c…`) is restored as its own work. It holds Europa-América Contemporânea #52, #54 and #56 (9789721051409, 9789721049796, 9789721053199). Three collection numbers, after #51 for Fellowship, make these volumes, not a one-volume edition. Neither BNP (no record for these ISBNs) nor Open Library says which volume each is, so they stay together outside the omnibus.
- **The omnibus** (`48275c0b…`, OL27448W) keeps the English one-volume, illustrated, deluxe and box-set editions.
- **Series rows** (in the undo file):
  - drop the omnibus's Wikidata row "The Lord of the Rings" at position 2;
  - add Fellowship at position 1 and Two Towers at position 2;
  - Return of the King (`adc3706d…`) keeps its position 3.

## Runbook

Run this after the deploy that carries PR #365 and this PR, once the pre-2002 BNP import has finished. Run each command from the Mac.

1. **Dry run (read-only):**

   ```bash
   railway ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c "cd backend && node scripts/undo-series-merges.mjs --guarded > /dev/null"
   ```

   Expected: `checked 5522, skipped 20, flagged 95`, give or take a few joins made since 2026-10-25.
2. **Undo:**

   ```bash
   railway ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c "cd backend && node scripts/undo-series-merges.mjs --undo ../docs/repairs/2026-10-25-volume-joins-undo.json"
   ```

   Expected: 61 undone (60 + 1 manual), `failures: []`, `dropped: 1`, `added: 2`. The run is all-or-nothing: if any id is no longer an active merge, nothing is undone and the script exits 1 naming it. Bring that output back for review.
3. **Detaches and manual merges:**

   ```bash
   railway ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c "cd backend && node ../docs/repairs/2026-10-25-volume-joins-finish.mjs"
   ```

   Expected: three `detached` and two `merged` entries.
4. **Check (read-only, Claude runs it):**
   - OL27513W and OL27479W are unmerged works holding the editions listed above.
   - The omnibus holds only its English one-volume, illustrated, deluxe and box-set editions.
   - The series rows read: Fellowship 1, Two Towers 2, Return of the King 3.
   - `--guarded` flags only the 38 kept joins.

## Flagged joins

| Merge | Source | Conf. | From (Portuguese) | Into | Guard | Decision | Reason |
|---|---|---|---|---|---|---|---|
| 140 | code |  | [EBOOK] As Sete Irmãs: a história de Maia – As Sete Irmãs 1 | The Seven Sisters | review | keep | the whole novel (series book or first book); the join is right |
| 146 | code |  | As Sete Irmãs: a história de Maia – As Sete Irmãs 1 | The Seven Sisters | review | keep | the whole novel (series book or first book); the join is right |
| 415 | code |  | Um Mundo Sem Fim – Volume II | World Without End | review | undo | split volume of one novel; split volumes are works of their own |
| 416 | code |  | [EBOOK] Um Mundo Sem Fim – Volume II | World Without End | review | undo | split volume of one novel; split volumes are works of their own |
| 422 | code |  | Os Pilares da Terra - Volume II | The Pillars of the Earth | review | undo | split volume of one novel; split volumes are works of their own |
| 456 | jev | 0.98 | Memória do Fogo I | Memory of fire | never | undo | volume I of a trilogy, joined into the trilogy |
| 483 | jev | 1 | O Conde de Monte Cristo I | Le Comte de Monte-Cristo | never | undo | split volume of one novel; split volumes are works of their own |
| 486 | jev | 1 | Os Miseráveis I | Os miseráveis | never | undo | split volume of one novel; split volumes are works of their own |
| 578 | jev | 0.94 | O Inferno de Gabriel A Saga de Gabriel - Livro I | Gabriel's inferno | review | keep | the whole novel (series book or first book); the join is right |
| 601 | jev | 1 | [EBOOK] Wolf Hall | Wolf Hall | review | keep | the whole novel (series book or first book); the join is right |
| 604 | jev | 1 | Wolf Hall | Wolf Hall | review | keep | the whole novel (series book or first book); the join is right |
| 650 | jev | 1 | [EBOOK] Os Pilares da Terra – Volume II | The Pillars of the Earth | review | undo | split volume of one novel; split volumes are works of their own |
| 1870 | jev | 0.96 | O Nome da Rosa, Vol. 2 | The Name of the Rose (including author's postscript) | never | undo | split volume of one novel; split volumes are works of their own |
| 1999 | jev | 0.94 | Calvin & Hobbes | Calvin and Hobbes | review | keep | the first Calvin and Hobbes collection; same book |
| 2066 | jev | 1 | O ROMANCE DO GENJI (parte 2) | The Tale of Genji | never | undo | split volume of one novel; split volumes are works of their own |
| 2067 | jev | 1 | O ROMANCE DO GENJI (parte 1) | The Tale of Genji | never | undo | split volume of one novel; split volumes are works of their own |
| 2123 | jev | 1 | BELOS CAVALOS | All the Pretty Horses (Border Trilogy) | review | keep | the novel; the target title only carries a series note |
| 2304 | jev | 1 | Não! (O Macaco Rabugento) | Grumpy Monkey | review | undo | a Grumpy Monkey sequel joined into the first book |
| 2312 | jev | 0.92 | Já chegámos? (O Macaco Rabugento) | Grumpy Monkey | review | undo | a Grumpy Monkey sequel joined into the first book |
| 2343 | jev | 0.96 | Blhec, não gosto! (O Macaco Rabugento) | Grumpy Monkey | review | undo | a Grumpy Monkey sequel joined into the first book |
| 2369 | jev | 1 | Um Mundo Sem Fim – Volume I (+1) | World Without End | review | undo | split volume of one novel; split volumes are works of their own |
| 2375 | jev | 1 | Acabado de Espremer! (O Macaco Rabugento 1) | Grumpy Monkey | review | undo | a Grumpy Monkey graphic novel joined into the first book |
| 2396 | jev | 1 | Lore Olympus: Volume 1 (parte 2) | Lore Olympus | never | undo | split volume of one novel; split volumes are works of their own |
| 2401 | jev | 1 | Lore Olympus: Volume 1 (parte 1) | Lore Olympus | never | undo | split volume of one novel; split volumes are works of their own |
| 2418 | jev | 0.91 | Deuses e afins (Enciclopédia da Estória Universal 7) | Enciclopedia da estoria universal | review | undo | a separate book of the series, not the series or omnibus work |
| 2455 | jev | 0.98 | Oh, não, é Natal! (O Macaco Rabugento) | Grumpy Monkey | review | undo | a Grumpy Monkey sequel joined into the first book |
| 2482 | jev | 0.96 | O macaco rabugento não quer dormir (O Macaco Rabugento) | Grumpy Monkey | review | undo | a Grumpy Monkey sequel joined into the first book |
| 2489 | jev | 0.99 | Sapiens: A Origem da Humanidade (Novela Gráfica, vol.1) | Sapiens | review | undo | the graphic-novel adaptation, a separate work |
| 2503 | jev | 1 | O macaco rabugento (O Macaco Rabugento) | Grumpy Monkey | review | keep | the first Grumpy Monkey book; same book |
| 2512 | jev | 0.94 | E se Formos Nós | What If It's Us - Signed / Autographed Copy | review | keep | the novel; the target title carries a seller note |
| 2588 | jev | 0.9 | Mil anos de esquecimento (Enciclopédia da Estória Universal 5) | Enciclopedia da estoria universal | review | undo | a separate book of the series, not the series or omnibus work |
| 2621 | jev | 0.92 | Arquivos de Dresner (Enciclopédia da Estória Universal 2) | Enciclopedia da estoria universal | review | undo | a separate book of the series, not the series or omnibus work |
| 2622 | jev | 0.96 | Recolha de Alexandria (Enciclopédia da Estória Universal 1) | Enciclopedia da estoria universal | review | undo | a separate book of the series, not the series or omnibus work |
| 17403 | code |  | Zeros e Cruzes (Noughts & Crosses) | Noughts & Crosses (Noughts & Crosses Trilogy) | review | keep | the novel; the target title only carries a series note |
| 17475 | code |  | Guerreiro das Trevas – Parte Dois | Stygian | review | undo | split volume of one novel; split volumes are works of their own |
| 17484 | code |  | Guerreiro das Trevas – Parte Um | Stygian | review | undo | split volume of one novel; split volumes are works of their own |
| 17487 | code |  | Viúva de Ferro | Iron Widow | review | keep | the whole novel (series book or first book); the join is right |
| 17514 | code |  | A Vingança Serve-se Fria – Parte Um | Best Served Cold | review | undo | split volume of one novel; split volumes are works of their own |
| 17525 | code |  | Tempestade de Guerra – Parte 1 | War Storm | review | undo | split volume of one novel; split volumes are works of their own |
| 17530 | code |  | Sangue e Fogo – Volume 1 – Parte 2 | Fire & blood | review | undo | split volume of one novel; split volumes are works of their own |
| 17533 | code |  | Sangue e Fogo – Volume 1 – Parte 1 | Fire & blood | review | undo | split volume of one novel; split volumes are works of their own |
| 17590 | code |  | A Morte do Comendador Volume I | Killing Commendatore | never | undo | split volume of one novel; split volumes are works of their own |
| 17612 | code |  | A Indomável Miss Bridgerton Série Rokesby - Volume I (Portuguese Edition) | Because of Miss Bridgerton | review | keep | the whole novel (series book or first book); the join is right |
| 17614 | code |  | O Homem Pintado Ciclo dos Demónios - Livro 1 | The Painted Man | review | keep | the whole novel (series book or first book); the join is right |
| 17776 | code |  | Teu para sempre | A Dog's Purpose | review | keep | the whole novel (series book or first book); the join is right |
| 17801 | code |  | A passagem | The Passage | review | keep | the whole novel (series book or first book); the join is right |
| 17811 | code |  | Imperador (+1) | Emperor | review | keep | the whole novel (series book or first book); the join is right |
| 17975 | code |  | A quimera de Praga | Daughter of Smoke and Bone | review | keep | the whole novel (series book or first book); the join is right |
| 18408 | code |  | Os nossos fins violentos.. Livro 2 | Our Violent Ends | review | keep | the whole novel (series book or first book); the join is right |
| 18602 | code |  | Adivinha quanto eu gosto de ti (+2) | Guess how much I love you | review | keep | the whole novel (series book or first book); the join is right |
| 18869 | code |  | Mundos paralelos (+1) | His Dark Materials | review | undo | Northern Lights joined into the His Dark Materials series work |
| 18914 | code |  | O clube dos sete (+2) | The Secret Seven | review | keep | the whole novel (series book or first book); the join is right |
| 18968 | code |  | Henrique, o terrível | Horrid Henry | review | keep | the whole novel (series book or first book); the join is right |
| 19471 | code |  | A história de uma serva (+1) | The Handmaid's Tale | review | undo | the graphic-novel adaptation, a separate work |
| 19581 | code |  | Eterno Sonhador.. Vol. 1 | Strange the Dreamer | review | keep | the whole novel (series book or first book); the join is right |
| 19609 | code |  | Astroboy 2 | Astroboy | review | undo | manga volume joined into the series |
| 19610 | code |  | Astroboy 1 | Astroboy | review | undo | manga volume joined into the series |
| 19797 | code |  | Pippi das meias altas | Pippi Longstocking | review | keep | the whole novel (series book or first book); the join is right |
| 19940 | jev | 1 | O Segundo Sexo – Vol. 2 | The Second Sex | review | undo | split volume of one novel; split volumes are works of their own |
| 19968 | jev | 0.95 | A Senhora do Lago – Parte 1 | The Lady of the Lake | review | undo | split volume of one novel; split volumes are works of their own |
| 19992 | jev | 0.99 | A Irmandade do Anel (+2) | The Lord of the Rings | review | undo | Fellowship (OL27513W) joined into the omnibus; BNP gave the series name as its original title |
| 19993 | jev | 0.97 | As duas Torres (+1) | The Lord of the Rings | review | undo | Two Towers (OL27479W) joined into the omnibus |
| 19994 | jev | 0.91 | Anúncio de um crime (+3) | Murder on the Orient Express / A Murder is Announced | review | undo | a single novel joined into an omnibus |
| 20005 | jev | 0.99 | Para Sir Phillip com Amor Série Bridgerton - Volume V (Portuguese Edition) | To Sir Philip, with Love | review | keep | the whole novel (series book or first book); the join is right |
| 20007 | jev | 1 | Um Casamento Conveniente Girl Meets Duke - Volume 1 (2ª Edição) | The Duchess Deal | review | keep | the whole novel (series book or first book); the join is right |
| 20020 | jev | 0.97 | Tuneis | Tunnels | review | keep | the whole novel (series book or first book); the join is right |
| 20050 | jev | 1 | A Coisa - Livro 1 Livro 1 | It | review | undo | split volume of one novel; split volumes are works of their own |
| 20125 | jev | 0.99 | Álbum de família | Kaleidoscope / Family Album | review | undo | a single novel joined into an omnibus |
| 20159 | jev | 0.94 | Memórias da irmã Lúcia II | Memórias da Irmã Lúcia | never | undo | split volume of one novel; split volumes are works of their own |
| 20203 | jev | 0.99 | A guerra das estrelas | Star Wars | review | keep | the Star Wars novelization titled Star Wars; same book |
| 20246 | jev | 0.99 | Operação Overlord | Overlord | review | keep | same book |
| 20302 | jev | 1 | O idealista | March | review | keep | the whole novel (series book or first book); the join is right |
| 20362 | jev | 0.96 | The promised Neverland.. Vol. 2,. Controlo | The promised Neverland | review | undo | manga volume 2 joined into the series |
| 20413 | jev | 0.95 | O senhor dos anéis (+2) | The Lord of the Rings | review | undo | Europa-América Contemporânea #52/#54/#56: three numbered books, so volumes, not a one-volume edition; volume titles unknown, so they stay one work of their own |
| 20522 | jev | 0.99 | Esses prazeres violentos.. Livro 1 | These Violent Delights | review | keep | the whole novel (series book or first book); the join is right |
| 20727 | jev | 0.92 | Fui ao mar buscar laranjas.. Vol. 1 | Fui ao mar buscar laranjas | review | undo | split volume of one novel; split volumes are works of their own |
| 20778 | jev | 1 | A escola do bem e do mal | The School for Good and Evil | review | keep | the whole novel (series book or first book); the join is right |
| 20812 | jev | 0.92 | Meio sol amarelo (+1) | Americanah / Half of a Yellow Sun / Purple Hibiscus | review | undo | a single novel joined into an omnibus |
| 20835 | jev | 0.97 | Diário de uma totó 4 1/2 | How To Dork Your Diary | review | keep | the whole novel (series book or first book); the join is right |
| 20867 | jev | 0.99 | O regresso do cavaleiro das trevas II | Batman: the Dark Knight Returns | never | undo | split volume of one novel; split volumes are works of their own |
| 20997 | jev | 1 | Quatro | Four: A Divergent Collection | review | keep | Four is the collection itself |
| 21014 | jev | 0.99 | As piores crianças do mundo 1 | World's Worst Children | review | keep | the whole novel (series book or first book); the join is right |
| 21018 | jev | 0.91 | Star wars, o despertar da força | Star Wars | review | undo | The Force Awakens joined into the Star Wars novelization |
| 21045 | jev | 0.95 | ASP.NET 4.5.1 | ASP. NET 4.5 | review | keep | same book, a minor version difference |
| 21158 | jev | 0.98 | Blacksad.. Vol. 1,. Algures entre as sombras | Blacksad | review | undo | album 1 joined into the Dark Horse omnibus work |
| 21184 | jev | 0.95 | Lendas e narrativas.. Tomo I | Lendas e narrativas | review | undo | split volume of one novel; split volumes are works of their own |
| 21188 | jev | 0.95 | Lendas e narrativas.. Tomo II | Lendas e narrativas | review | undo | split volume of one novel; split volumes are works of their own |
| 21261 | jev | 0.99 | Twisted love.. Livro 1 | Twisted Love | review | keep | the whole novel (series book or first book); the join is right |
| 21273 | jev | 0.96 | Powerless.. Livro 1 | Powerless | review | keep | the whole novel (series book or first book); the join is right |
| 21278 | jev | 0.98 | História de Portugal.. Vol. VII,. Portugal na Europa das Luzes | História de Portugal | review | undo | volume VII of a multi-volume history |
| 21283 | jev | 0.91 | Contos completos 2 | The Complete Tales of Beatrix Potter | review | undo | split volume of one novel; split volumes are works of their own |
| 21289 | jev | 0.9 | A cor do hibisco (+1) | Americanah / Half of a Yellow Sun / Purple Hibiscus | review | undo | a single novel joined into an omnibus |
| 21301 | jev | 0.96 | Humano, demasiado humano I | Human, all-too-human | never | undo | split volume of one novel; split volumes are works of their own |
| 21304 | jev | 0.97 | Phantasma.. Livro I | Phantasma | review | keep | the whole novel (series book or first book); the join is right |
| 21334 | jev | 1 | Cadernos de Lanzarote - Diário.. Vol. IV | Cadernos de Lanzarote | review | undo | a later volume of the diary, joined into volume I |
| 423 | | | Os Pilares da Terra – Volume I [EBOOK] (code join, not flagged: Volume I matched the target's series position 1) | | not flagged | undo | follow-on |
| 424 | | | Os Pilares da Terra - Volume I (same as 423) | | not flagged | undo | follow-on |
| 23431 | | | title-key fold of the Galician A irmandade do anel (9788483026823) into the omnibus; it belongs with Fellowship | | not flagged | undo | follow-on |
| 671 | manual | | O Conde de Monte Cristo II | Le Comte de Monte-Cristo | not flagged | undo | split volume; manual merge |
