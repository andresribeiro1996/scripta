# Book data providers

Every source the catalog reads books or covers from, and how each one behaves. Surveyed 2026-10-01 with one request at a time, at least 3 s apart, user agent `Atmyshelf/1.0 (+https://atmyshelf.com)`. The background research behind these choices is in [`portuguese-book-sources.md`](portuguese-book-sources.md). How the importer and the seed run is in [`backend/README.md`](../backend/README.md), section Seeding.

**Portugal edition** means an ISBN starting `978-972` or `978-989`. The importer only keeps books with a Portugal ISBN. Covers it stores are `cover_images.source = 'publisher'`, `books.cover_status = 'manual'`, and are never replaced automatically. Each cover records its shop's origin (`cover_images.origin`) and each book the product page (`books.publisher_url`).

## Automatic sources

| Source | Used for | Limits | Intricacies |
|---|---|---|---|
| **Apple Books** (`itunes.apple.com/lookup`, `/search`) | Covers: the seed (background lane, first) and upgrades of weak covers (upgrade lane, only source). Never on a user's import path. | No key. About 1 request every 3.2 s for the whole server, shared by both Apple lanes, one lookup at a time. | **Storefront:** asks the `pt` storefront first for `972`/`989` ISBNs and `br` for `85`/`65`, then the others. **Size:** `artworkUrl100` is rewritten to `1400x1400bb`. **Small publishers:** often absent, because they don't sell ebooks there. |
| **ISBNdb** (`api2.isbndb.com`) | Covers for imports (fast lanes, first), gap-filling in the seed, details and search when Open Library lacks them. | Paid plan: 5,000 requests a day, resetting 00:00 UTC, about 1 request/s (1.1 s throttle). | **Daily quota:** a 429 "Daily quota exceeded" pauses every ISBNdb call until the reset (`isbndbGate.ts`). **Rejected key:** a 401/403 pauses until midnight UTC and emails `ALERT_EMAIL`. **Watermarks:** some Portugal-edition covers carry one, so Apple replaces them in the upgrade lane. **Terms:** if the subscription lapses, everything from ISBNdb must be deleted (README has the steps). |
| **Open Library** (`openlibrary.org`) | The seed list (`search.json`, ranked by `readinglog`), details, external search, last-resort covers, and the importer's author and edition-title lookups (for books with no author from the shop only; a page-sourced ISBN is accepted by shop uniqueness and only on a run where every page succeeded, never by comparing titles with Open Library). The work key (`books.ol_work_key`) is stored from the seed, from the importer's `/isbn/{isbn}.json` lookup, and from details and search; nothing reads it yet. | No key. 1 request/s; covers 1 per 3.1 s. Its search can take 10 s or more, so the seed builder uses a 60 s timeout. | **Edition titles:** `q=isbn:978972*` returns the matching Portugal edition, but an `OR` of two prefixes loses it, so the seed runs one query per prefix. For an exact `isbn:` query, `search.json` returns the **work** title (the original language), so the importer takes the edition title from `/isbn/{isbn}.json` instead. **Covers:** rarely at least 400 px. |
| **Google Books** | Not used. | — | Measured on 2026-09-27: 11 good covers out of 139, thumbnails only. |

## Publishers in the importer

Feed URLs, Shopify: `{origin}/products.json?limit=250&page=N`. WooCommerce: `{origin}/wp-json/wc/store/v1/products?per_page=100&page=N`. A product whose feed has no Portugal ISBN gets its product page read (strict picker plus title check, see README).

| Publisher | Origin | Platform | Products | ISBN found in | Author from | Cover | Intricacies |
|---|---|---|---|---|---|---|---|
| Antígona | antigona.pt | Shopify | ~470 in feed (~860 URLs in sitemap) | `body_html`, else the product page | `vendor` (`authorFromVendor: true`) | up to 1618×2480 | **ISBN format:** written with a U+2011 non-breaking hyphen (`978‑972‑608‑493-8`). **SKU:** free text. |
| Orfeu Negro / Orfeu Mini | orfeunegro.org | Shopify | ~350–540 | `body_html` (some), else the page | Open Library | up to 7087×2480 | **Vendor:** the imprint ("Orfeu Mini"), not the author. **SKU:** internal (`OM0393`). |
| Imprensa Nacional (INCM) | loja.incm.pt | Shopify | 1,896 | the page | Open Library | up to 901×600 | Mostly coins, medals and prints (Casa da Moeda). A named-bot `Disallow` and `Crawl-delay: 10` apply to other bots, not `*`. |
| Relógio d'Água | www.relogiodagua.pt | WooCommerce | 2,299 | image file name (`9789897837579-scaled.jpg`) | Open Library; the page has an `/autor/` link | up to 2560 (`-scaled`) | **Titles:** in capitals in the feed, so the Open Library edition title is preferred. **Feed:** `sku` and `attributes` are empty. |
| Exclamação | exclamacao.pt | WooCommerce | 3,098 | feed (about a third), else the page | Open Library | ? | Mixed catalogue: many products without an ISBN. |
| Abysmo | abysmo.pt | WooCommerce | 200 | `ISBN` attribute, image file name | `Autor` attribute | up to 1200 | Clean. Every book in the feed has an author. |
| Gradiva | www.gradiva.pt | WooCommerce | 1,523 | the page (`ISBN:` row) | Open Library; the page has an `/autor/` link | up to 1690 | **Crawl-delay:** 3. **Merchandise:** bookmarks and similar. **SKU:** internal. |
| Kathartika | www.kathartika.pt | WooCommerce | 73 | `ISBN` attribute (all products) | Open Library | ? | Small horror/genre press. `robots.txt` is `Allow: /`. |
| Guerra & Paz | guerraepaz.pt | WooCommerce | 1,302 | the page (`ISBN:` row) | Open Library | 600×909 | **SKU:** internal. **Host:** the feed's `permalink` points at `www.`. **Certificate:** `guerraepaz.net` has a bad one. |
| Pato Lógico | pato-logico.com | Shopify | 136 | the page | Open Library | up to 1946 wide | Children's books. |
| Presença (Marcador, Manuscrito) | www.presenca.pt | Shopify | ~8–10k | variant SKU = ISBN, also `body_html` | Open Library | 400×595 seen | **Vendor:** the imprint. **Ebooks:** `[EBOOK]` products carry their own ISBNs, so they come in as their own books. **Size:** the largest site in the importer. |
| Edições Afrontamento | www.edicoesafrontamento.pt | Shopify | ~2–3k | the page (unverified) | Open Library | up to 2048 | **Vendor:** the publisher's name. **Feed:** SKU, barcode and body are empty, so it depends entirely on the page step and its uniqueness rule. |
| Saída de Emergência | www.saidadeemergencia.com | WooCommerce | 1,073 | image file name (some), else the page | Open Library; the page has an `/autor/` link | about 400 wide | **Cloudflare:** sits in front, and the owner mentions aggressive bot traffic, so keep the wait and watch `pagesBlocked`. **Size:** covers are near the 400 px floor. |
| Divergência | divergencia.pt | WooCommerce | 218 | `sku` = ISBN, image file name | Open Library | 814 wide | Small SF/fantasy press. |
| Penguin Livros (Alfaguara, Companhia das Letras, Elsinore, Cavalo de Ferro, Topseller, Booksmile, Nascente, Vogais) | penguinlivros.pt | WooCommerce | 5,821 | the page (`ISBN` row); `sku` is internal (`PA99555`) | Open Library; the page has `Autor(a)` links to `/autores/` | up to 1692 wide | Group-owned (Penguin Random House), added on 2026-10-01 by the owner's decision. elsinore.pt, topseller.pt and booksmile.pt redirect here. Page-only ISBNs, so shop uniqueness decides every book. |

`imageUrlPrefix` for each site (needed for a takedown) is in the README table after the first real run.

## Candidates not yet in the importer

| Publisher | Origin | Why not yet | What it would take |
|---|---|---|---|
| Edições do Saguão | www.edicoesdosaguao.pt | Shopkit, a Portuguese platform: `/products.json` returns `{data, paging, total_count}`, not Shopify's shape. | A third parser. `Crawl-delay: 10`, enforced with a 429. 73 products, ISBN and `Autor:` in the description. |
| Letras Lavadas | www.letraslavadas.pt | It also sells other publishers' books (an `Editora` attribute), which is the retailer case. | A per-site filter on `Editora` = Letras Lavadas. 622 products, `ISBN` attribute. |
| Sistema Solar (Documenta) | sistemasolar.pt | A custom PHP shop with no feed. ISBNs appear only in image file names. | A crawler for its product listing pages. `robots.txt` allows it. |

## Contact first

These can't, or shouldn't, be read automatically. Ask for permission to show their covers with a link back to their shop, and ideally for a catalogue file (ISBN, title, author, image link). The contacts are public business addresses found on their sites or public listings on 2026-10-01; check them before sending.

| Publisher | Why | Contact |
|---|---|---|
| **Tinta-da-China** | Cloudflare bot challenge on every page, `robots.txt` included. Never bypass it. | info@tintadachina.pt |
| Livros Horizonte | WooCommerce REST API disabled; `robots.txt` names AI bots and sets `ai-train=no`. | geral@livroshorizonte.pt, editorial@livroshorizonte.pt |
| Sistema Solar | No feed (see above). | editora@sistemasolar.pt |
| E-Primatur | Custom shop, no feed, no ISBN on its pages. | geral@e-primatur.com, comercial@e-primatur.com |
| Bizâncio | Site timed out on every attempt. | bizancio@editorial-bizancio.pt |
| Edições do Saguão | Needs its own parser (see above). | saguao.edicoes@yahoo.com |
| Edições Húmus | OpenCart, no feed. | humus@humus.com.pt |
| Chili com Carne | Joomla shop, no feed. | ccc@chilicomcarne.com |
| Ala dos Livros | Joomla, unstable (503). | aladoslivros.com/index.php/contactos |
| Companhia das Ilhas | WordPress without a shop feed. | companhiadasilhas.lda@gmail.com |
| Zigurate | VTEX shop, `Crawl-delay: 60`. | livroszigurate@zigurate.pt |
| VS. Editor | Wix, no ISBN on its pages. | vascosantoseditor@gmail.com |
| Língua Morta | Blog only. | edlinguamorta@gmail.com |
| Douda Correria | Blog only; sold through other shops. | doudacorreria107@gmail.com |
| Polvo | No shop of its own. | polvoeditora@gmail.com |
| Ahab | No shop of its own. | Rua de Vilar 10, 2º, 4050-625 Porto (APEL member list) |
| Maldoror | No shop of its own. | feiradolivrodelisboa.pt/participantes/maldoror/ |

**Group-owned, all blocking bots (Cloudflare or AWS 403).** Apple most likely covers them. Contact them only if their gaps show up after the seed.

| Group | Imprints | Contact |
|---|---|---|
| Porto Editora | Porto Editora, Assírio & Alvim, Livros do Brasil (ownership unverified) | portoeditora.pt/contactos, livrosdobrasil.pt/contactos |
| Bertrand / Círculo | Bertrand Editora, Contraponto, Quetzal (ownership unverified), Temas e Debates (listed under Leya by the survey) | editora@bertrand.pt |
| Leya | Dom Quixote, Caminho, Lua de Papel, ASA, Casa das Letras, Oficina do Livro, Texto. Custom platform, no feed, `Crawl-delay: 15`. | comunicacao@leya.com |
| Almedina | Almedina, Edições 70 | geral@almedina.net, editora@grupoalmedina.net |
| Planeta | Planeta. Custom platform, no feed. | info@planeta.pt |
| Penguin Random House | in the importer (penguinlivros.pt); contact only if they object | correio@penguinrandomhouse.com |

### Email draft (Portuguese)

> **Assunto:** Capas dos vossos livros no Atmyshelf
>
> Olá,
>
> Chamo-me [nome] e estou a desenvolver o Atmyshelf (atmyshelf.com), uma aplicação gratuita onde os leitores organizam a sua biblioteca pessoal e partilham o que estão a ler.
>
> Gostaríamos de mostrar as capas dos vossos livros nas fichas das respetivas edições, com o nome da editora e uma ligação para a página do livro na vossa loja. As capas seriam usadas apenas para identificar cada livro.
>
> Podemos contar com a vossa autorização? Se tiverem um ficheiro de catálogo (ISBN, título, autor e ligação para a capa), isso ajudar-nos-ia a manter os dados corretos. Se preferirem que não usemos as vossas capas, basta dizerem-nos e removemo-las de imediato.
>
> Obrigado,
> [nome]
> Atmyshelf

## Excluded

Fenda (in liquidation); Cotovia (closed 2020, domain reused); Cultura Editora (site gone); Dinalivro (domain hijacked); Snob (a bookshop, not a publisher). Flâneur, Bruaá and Planeta Tangerina were dropped from the first importer: Flâneur's `/products.json` 404s, Bruaá has no Store API, and Planeta Tangerina's feed answers 500.
