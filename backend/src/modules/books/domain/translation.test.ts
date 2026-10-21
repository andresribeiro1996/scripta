import assert from "node:assert/strict";
import { test } from "node:test";
import { authorPattern, evidenceOf, hasVolumeMarker, isOriginalTitle, isPortuguese, mainTitle, mentionsSurname, originalKey, originalTitleIn, sameMainTitle, seriesLikeGroups, seriesLikeOriginals, surnameOf, titlePattern } from "./translation.js";

test("originalTitleIn reads the labelled value to the end of its line", () => {
  assert.equal(originalTitleIn("Uma sinopse.\n\nTítulo original: Les Misérables"), "Les Misérables");
  assert.equal(originalTitleIn("Titulo original - The Pure."), "The Pure");
  assert.equal(originalTitleIn("Tradução de Ana Lima. Título original Der Spaziergang\nOutra linha"), "Der Spaziergang");
  assert.equal(originalTitleIn("TÍTULO ORIGINAL — Ökendykarna;"), "Ökendykarna");
  assert.equal(originalTitleIn("Título original:   "), null);
  assert.equal(originalTitleIn(`Título original: ${"x".repeat(201)}`), null);
  assert.equal(originalTitleIn("Uma sinopse sem rótulo."), null);
  assert.equal(originalTitleIn(null), null);
});

test("originalTitleIn returns nothing when the label has no title after it", () => {
  assert.equal(originalTitleIn("Uma sinopse.\n\nTítulo original:"), null);
  assert.equal(originalTitleIn("Título original:\nTradução: Ana Lima"), null);
  assert.equal(originalTitleIn("Título original:\nPáginas: 300"), null);
  assert.equal(originalTitleIn("Título original —"), null);
});

test("originalTitleIn still reads a value on the line after a bare label, digits and non-Latin titles", () => {
  assert.equal(originalTitleIn("Título original\n\nThe Hobbit"), "The Hobbit");
  assert.equal(originalTitleIn("Título original: 1984"), "1984");
  assert.equal(originalTitleIn("Título original: Солярис"), "Солярис");
});

test("isOriginalTitle needs a letter or digit and rejects another metadata label", () => {
  for (const value of [":", "", "—", "Tradução: Ana Lima", "Tradução - Ana Lima", "ISBN: 9780000000002", "Ano: 2019"]) assert.equal(isOriginalTitle(value), false, value);
  for (const value of ["Solaris", "1984", "Солярис", "Sapiens: A Brief History of Humankind", "Data-Driven Science"]) assert.equal(isOriginalTitle(value), true, value);
});

test("the main title stops at the first dash or full-stop separator", () => {
  assert.equal(mainTitle("Lipstick Traces — A Secret History of the Twentieth Century"), "Lipstick Traces");
  assert.equal(mainTitle("Autobiographie d'un poulpe - et autres récits"), "Autobiographie d'un poulpe");
  assert.equal(mainTitle("Brave New World"), "Brave New World");
});

test("sameMainTitle compares main titles the catalog's way, numbers included", () => {
  assert.equal(sameMainTitle("To the Lighthouse — A Novel", "To the Lighthouse: A Novel"), true);
  assert.equal(sameMainTitle("Memorial do Convento", "Memorial do convento"), true);
  assert.equal(sameMainTitle("1984", "1985"), false);
  assert.equal(sameMainTitle("", ""), false);
});

test("Portuguese means a pt language tag", () => {
  assert.deepEqual(["pt", "pt-PT", "pt-BR", "en", null, "ptx"].map(isPortuguese), [true, true, true, false, false, false]);
});

test("title and author patterns match the catalog's title keys", () => {
  assert.equal(titlePattern("To the Lighthouse — A Novel"), "ta:to the lighthouse|*|");
  assert.equal(titlePattern("1984"), "ta:1984|*|1984");
  assert.equal(titlePattern("   "), null);
  assert.equal(authorPattern("Virginia Woolf, Ana Lima"), "virginia woolf|*");
  assert.equal(authorPattern(""), null);
});

test("the surname is the last word of three or more letters, matched whole", () => {
  assert.equal(surnameOf("Fiódor Dostoiévski"), "dostoievski");
  assert.equal(surnameOf("José Saramago, Ana Lima"), "saramago");
  assert.equal(surnameOf("Li Bo"), null);
  assert.equal(mentionsSurname(["Um romance de Virginia Woolf."], "woolf"), true);
  assert.equal(mentionsSurname(["Woolfgang"], "woolf"), false);
  assert.equal(mentionsSurname([null, "Sem autor."], "woolf"), false);
});

test("evidence takes each field from the oldest edition that has it, and reads original titles from summaries", () => {
  const evidence = evidenceOf({
    workId: "w",
    workAuthor: "Robert Walser",
    editions: [
      { title: "O Passeio", author: "", publisher: null, summary: "Um passeio.\n\nTítulo original: Der Spaziergang", originalTitle: null },
      { title: "O Passeio (2.ª ed.)", author: "Robert Walser", publisher: "Relógio d'Água", summary: "Outra sinopse.", originalTitle: null }
    ]
  });
  assert.deepEqual(evidence, { workId: "w", title: "O Passeio", author: "Robert Walser", workAuthor: "Robert Walser", publisher: "Relógio d'Água", summary: "Um passeio.\n\nTítulo original: Der Spaziergang", originalTitle: "Der Spaziergang", summaries: ["Um passeio.\n\nTítulo original: Der Spaziergang", "Outra sinopse."] });
});

test("a volume marker is found wherever the catalog's title key would drop it", () => {
  for (const title of ["The Selection: The Elite (Book 2)", "The Selection: The One (book3)", "The Selection #2", "Saga, Vol. 2", "A Seleção - Livro 2", "Dune: Book Two", "Les Rois maudits, tome IV", "Volume One"]) {
    assert.equal(hasVolumeMarker(title), true, title);
  }
  for (const title of ["To the Lighthouse: A Novel", "The Book Thief", "1984", "Fahrenheit 451", "The Book of Two Ways", "C# in Depth", "A Civil Action"]) {
    assert.equal(hasVolumeMarker(title), false, title);
  }
});

test("an original key is the main title the catalog compares, numbers included", () => {
  assert.equal(originalKey("To the Lighthouse — A Novel"), "to the lighthouse|");
  assert.equal(originalKey("1984"), "1984|1984");
  assert.equal(originalKey("Saga: Book 2"), "saga|2");
  assert.equal(originalKey("   "), null);
});

const claim = (title: string, original: string, author = "Janey Louise Jones", language: string | null = "pt-PT", workId: string | null = `work-${title}`) => ({ workId, title, author, language, originalTitle: original });

test("an original claimed by three distinct Portuguese titles of one author is series-like", () => {
  const titles = ["A Princesa Poppy e o Piquenique", "A Princesa Poppy e a Festa", "Poppy no Baile", "Poppy e o Cão"];
  const isSeriesLike = seriesLikeOriginals(titles.map((title) => claim(title, "Princess Poppy")));
  assert.equal(isSeriesLike("Princess Poppy", "Janey Louise Jones"), true);
  assert.equal(isSeriesLike("princess poppy — a story", "J. L. Jones"), true);
  assert.equal(isSeriesLike("Princess Poppy: Book 2", "Janey Louise Jones"), false);
  const two = seriesLikeOriginals(titles.slice(0, 2).map((title) => claim(title, "Princess Poppy")));
  assert.equal(two("Princess Poppy", "Janey Louise Jones"), false);
});

test("only Portuguese titles count, and the same title many times counts once", () => {
  const exupery = "Antoine de Saint-Exupéry";
  const isSeriesLike = seriesLikeOriginals([
    claim("O Principezinho", "Le petit prince", exupery, "pt-PT"),
    claim("O Principezinho", "Le petit prince", exupery, "pt-BR"),
    claim("O Principezinho", "Le petit prince", exupery, "pt"),
    claim("El principito", "Le petit prince", exupery, "es"),
    claim("The Little Prince", "Le petit prince", exupery, "en"),
    claim("Il piccolo principe", "Le petit prince", exupery, null)
  ]);
  assert.equal(isSeriesLike("Le petit prince", exupery), false);
});

test("the same original under two author surnames is grouped apart", () => {
  const isSeriesLike = seriesLikeOriginals([
    ...["Um", "Dois", "Três"].map((title) => claim(`Volume ${title}`, "Chronicles", "Ann Jones")),
    ...["Quatro", "Cinco"].map((title) => claim(`Volume ${title}`, "Chronicles", "Bob Smith"))
  ]);
  assert.equal(isSeriesLike("Chronicles", "Ann Jones"), true);
  assert.equal(isSeriesLike("Chronicles", "Bob Smith"), false);
  assert.equal(isSeriesLike("Chronicles", ""), false);
});

test("an edition titled like its original does not count toward the original being a series", () => {
  const isSeriesLike = seriesLikeOriginals([
    claim("Princess Poppy", "Princess Poppy"),
    claim("A Princesa Poppy e a Festa", "Princess Poppy"),
    claim("Poppy no Baile", "Princess Poppy")
  ]);
  assert.equal(isSeriesLike("Princess Poppy", "Janey Louise Jones"), false);
});

test("a claim with a blank title or original cannot make a series", () => {
  const isSeriesLike = seriesLikeOriginals([claim("", "Princess Poppy"), claim("  ", "Princess Poppy"), claim("Poppy no Baile", "Princess Poppy"), claim("A Festa", "Princess Poppy"), ...["Um", "Dois", "Três"].map((title) => claim(title, "   "))]);
  assert.equal(isSeriesLike("Princess Poppy", "Janey Louise Jones"), false);
  assert.equal(isSeriesLike("   ", "Janey Louise Jones"), false);
});

test("series-like groups name the original and list the distinct titles and the works that claim it", () => {
  const poppy = (title: string, workId: string | null, original = "Princess Poppy", author = "Janey Louise Jones", language: string | null = "pt-PT") => claim(title, original, author, language, workId);
  const groups = seriesLikeGroups([
    poppy("A Princesa Poppy e o Piquenique", "w1"),
    poppy("A Princesa Poppy e a Festa", "w2", "Princess Poppy - A Party"),
    poppy("Poppy no Baile", "w3", "princess poppy", "J. L. Jones", "pt-BR"),
    poppy("Poppy no Baile", "w4"),
    poppy("Poppy e o Cão", null),
    poppy("The Pink Party", "w5", "Princess Poppy", "Janey Louise Jones", "en"),
    claim("O Principezinho", "Le petit prince", "Antoine de Saint-Exupéry"),
    claim("O Pequeno Príncipe", "Le petit prince", "Antoine de Saint-Exupéry")
  ]);
  assert.deepEqual(groups, [
    {
      originalTitle: "Princess Poppy",
      titles: ["A Princesa Poppy e o Piquenique", "A Princesa Poppy e a Festa", "Poppy no Baile", "Poppy e o Cão"],
      workIds: ["w1", "w2", "w3", "w4"]
    }
  ]);
});

test("the groups are the originals the series-like predicate answers true for", () => {
  const claims = [
    ...["Um", "Dois", "Três"].map((title) => claim(`Volume ${title}`, "Chronicles", "Ann Jones")),
    ...["Quatro", "Cinco"].map((title) => claim(`Volume ${title}`, "Chronicles", "Bob Smith"))
  ];
  assert.deepEqual(seriesLikeGroups(claims).map((group) => [group.originalTitle, group.titles.length]), [["Chronicles", 3]]);
  const isSeriesLike = seriesLikeOriginals(claims);
  assert.equal(isSeriesLike("Chronicles", "Ann Jones"), true);
  assert.equal(isSeriesLike("Chronicles", "Bob Smith"), false);
});
