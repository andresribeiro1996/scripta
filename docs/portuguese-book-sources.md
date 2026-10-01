# Portuguese book sources

Research notes from 2026-10-01 on where to get Portugal-edition books and covers for the launch catalog. The work already planned is in [`superpowers/plans/2026-10-01-portuguese-catalog.md`](superpowers/plans/2026-10-01-portuguese-catalog.md): the ISBNdb pause, the Portugal seed list and the publisher importer. This file holds the evidence behind it and the leads it leaves for later.

**Portugal edition** means an ISBN starting with `978-972` or `978-989`. **Brazilian** means `978-85` or `978-65`.

## What the numbers say

**ISBNdb trial, 2026-09-30.** It looked up 200 "Portuguese" books from Open Library's `language:por` popularity ranking, storing nothing (run 36788144207):

| | Books | Apple ≥400px | ISBNdb ≥400px | Either |
|---|---|---|---|---|
| Portugal editions | 29 | 20 (69%) | 23 (79%) | 24 (83%) |
| Brazilian editions | 155 | 140 (90%) | 128 (83%) | 147 (95%) |
| Other or no prefix | 16 | | | |

- **The old seed list was mostly Brazilian.** Of the 5,000 `por` entries in it, only **684** were Portugal editions.
- **Portugal editions have the weakest covers.** The sample is small, so read these percentages as a direction rather than a measurement.

**Open Library can rank by ISBN prefix** (`search.json?q=isbn:978972*&sort=readinglog`):
- `978972`: 30,126 works; `978989`: 13,900 works.
- The edition it returns is the matching Portugal edition.
- An `OR` of the two prefixes loses the matched edition, so the plan runs one query per prefix.
- The ranking reflects Open Library's mostly English-speaking readers. The top results are translated bestsellers (Colleen Hoover, Harry Potter, Orwell), and Portuguese authors rank low.

## Automatic cover sources

| Source | Portugal editions | Notes |
|---|---|---|
| Apple Books | 69% good in the trial | Already queries the `pt` storefront first for `972`/`989` ISBNs (`apple.ts` `storefrontsFor`). Small publishers often don't sell ebooks there. |
| ISBNdb | 79% good | **Covers:** some Portugal-edition covers carry a watermark, so the upgrade lane replaces them with Apple's. **Terms:** everything from ISBNdb must be deleted if the subscription lapses (backend README). **Quota:** 5,000 requests a day, resetting 00:00 UTC (from search results; isbndb.com blocks automated reads). |
| Open Library | rarely ≥400px | 2026-09-27 bake-off. |
| Google Books | out | 2026-09-27 bake-off: 11 good out of 139, thumbnails only, larger sizes upscaled. |

## Publishers' own shops

**Where the best covers come from.**
- Publishers make their own covers, and their shops serve the originals.
- Retailers, Apple and ISBNdb get theirs second-hand: from the publisher or distributor at listing time, or from aggregated feeds.

**Retailers are out** (Wook, Bertrand, FNAC):
- their terms almost certainly forbid scraping;
- EU database rights protect their catalogues as a whole;
- they block bots;
- Wook belongs to Porto Editora.

**Publisher feeds:**
- **Shopify** has a public `GET /products.json?limit=250&page=N`. Tested on Antígona: `vendor` is the author, and images are up to 1476×2480.
- **WooCommerce** has a public `GET /wp-json/wc/store/v1/products?per_page=100&page=N`. Tested on Relógio d'Água: `sku` is empty, and the ISBN is in the image file name.

The full per-provider catalog, with each shop's quirks, the contact-first list and an email draft, is in [`publisher-catalog.md`](publisher-catalog.md). The table below is the first survey.

**Survey of 32 publishers, 2026-10-01.**
- It read each site through a fetcher, so the platform is inferred from URL patterns.
- "?" marks anything the survey couldn't confirm.
- Crawl-delay is the time `robots.txt` asks crawlers to wait between requests.

| Publisher | Site | Status | Platform | ISBN on page | Cover size seen | Notes |
|---|---|---|---|---|---|---|
| Antígona | antigona.pt | active, independent | Shopify | yes | up to 2048 | **In the importer** |
| Orfeu Negro | orfeunegro.org | active, independent | Shopify | yes | 1024 | **In the importer** |
| Pato Lógico | pato-logico.com | active, independent (children's) | Shopify | yes | up to 1946 wide | **In the importer** |
| Imprensa Nacional (INCM) | loja.incm.pt | active, state publisher | Shopify | yes | ? | **In the importer**. About 1,592 products |
| Flâneur | flaneur.pt | active, independent | Shopify | yes | ? | **In the importer** |
| Relógio d'Água | relogiodagua.pt | active, independent | WooCommerce | yes | 665×1024 | **In the importer** |
| Guerra & Paz | guerraepaz.pt | active, independent | WooCommerce | yes | 600×909 | **In the importer**. About 1,200 products |
| Exclamação | exclamacao.pt | active, independent | WooCommerce | yes | ? | **In the importer** |
| Abysmo | abysmo.pt | active, independent | WooCommerce | yes | 416×555 | **In the importer**. Small covers |
| Gradiva | gradiva.pt | active, independent | WooCommerce | yes | 600×920 | **In the importer**. Crawl-delay 3; its robots.txt looks odd |
| Planeta Tangerina | planetatangerina.com | active, independent (children's) | WooCommerce | yes (dotted) | 600×690 | **In the importer** |
| Bruaá | bruaa.pt | live, no 2024+ title seen | WooCommerce | on catalogue page | ? | **In the importer** |
| Tinta-da-China | tintadachina.pt | active, independent | ? | ? | ? | Site blocks automated reads. **Email first** |
| Edições do Saguão | edicoesdosaguao.pt | active, independent | Shopkit | yes | ? | Crawl-delay 10. Would need a Shopkit parser |
| E-Primatur | e-primatur.com | active (crowdfunded) | custom | no | ? | |
| Sistema Solar (Documenta) | sistemasolar.pt | active | custom | ISBN only in image file names | ? | |
| Língua Morta | edlinguamorta.blogspot.com | active | Blogger | no | about 300×400 | |
| Douda Correria | doudacorreriablog.wordpress.com | active | WordPress.com blog, no shop | no | — | |
| VS. Editor | vseditor.net | active | Wix | no | 3108×4014 originals | |
| Livros Horizonte | livroshorizonte.pt | ? | ? | ? | ? | Site blocks automated reads |
| Bizâncio | editorial-bizancio.pt | probably active | WordPress? | ? | ? | Server refused the connection |
| Ahab, Maldoror | none found | ? | — | — | — | Sold through bookshops |
| Elsinore, Cavalo de Ferro | penguinlivros.pt | Penguin Random House | WooCommerce | yes | 600×928 | Group-owned |
| Edições 70 | almedina.net | Almedina | ? | ? | ? | Group-owned |
| Assírio & Alvim, Livros do Brasil, Quetzal | — | Porto Editora / Bertrand group | ? | ? | ? | Group-owned. Sites block automated reads |
| Fenda | — | in liquidation | — | — | — | |
| Cotovia | — | closed 2020 | — | — | — | |
| Snob | livrariasnob.pt | a bookshop, not a publisher | Shopkit | no | — | |

**Robots and politeness.**
- No surveyed `robots.txt` disallows book pages or the feeds.
- The importer's rules are in the plan: an honest user agent, ≥3 s between requests to a site, and a documented takedown.

## Other Portuguese sources

| Source | What it is | Verdict |
|---|---|---|
| [BiblioLED](https://www.biblioled.gov.pt/about) | The state ebook lending service (since January 2025), on De Marque's platform. Login through a municipal library. | **Not usable.** The catalogue is behind a login, the covers are licensed to them, and the ISBNs are for ebooks, not the printed editions readers own. Only a public "most borrowed" list would be interesting, and none was found. |
| [Projecto Adamastor](https://projectoadamastor.org/) | Free ebooks of 19th–20th-century Portuguese classics with designed covers. "Creative Commons" licence. WordPress with `/catalogo/` and an RSS feed. | **Worth a follow-up.** Probably no ISBNs, so its books would match only by title and author. It's a good source of Portuguese classics for the seed, which the Open Library ranking under-weights. |
| [Biblioteca Digital Camões](https://www.instituto-camoes.pt/activity/servicos-online/biblioteca-digital) | Instituto Camões: free full texts (literature, theses, essays, scores) plus a shared catalogue of its libraries in 54 countries. | **Not a cover source.** Metadata at most, and Open Library covers that. |
| Plano Nacional de Leitura | The state's recommended reading lists, including school reading and Portuguese classics. | **Unexplored.** It could rank Portuguese authors better than Open Library does. |
| PORBASE / Biblioteca Nacional | The national catalogue built from legal deposit: every book published in Portugal, with ISBNs. | **Unexplored.** Authoritative metadata, no covers, no popularity signal. |

## Open leads

1. **Email the publishers** when the importer first runs, starting with Tinta-da-China. The ask: permission to show their covers with a link back to their shop. A yes turns tolerance into permission, and some may send a catalogue file.
2. **Projecto Adamastor:**
   - Confirm the licence variant. A non-commercial one would matter if the app ever has paid features or ads.
   - Then add its classics to the Portuguese seed.
   - Use its covers only where a title-and-author match has no good cover.
3. **Portuguese authors in the seed.** Use the Plano Nacional de Leitura lists or a Wikidata query (writers from Portugal and their works) to add Portuguese authors that Open Library's ranking misses.
4. **More publishers:**
   - Saguão needs a Shopkit parser.
   - Tinta-da-China and Livros Horizonte need permission or another way in.
   - Sistema Solar's ISBNs are only in its image file names.
5. **After the seed,** compare the Portugal breakdown from `seed-catalog.mjs --status` with the trial row above, to see how much the publisher importer moved it.
