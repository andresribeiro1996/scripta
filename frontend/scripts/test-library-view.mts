import { filterBooks, nextReadStatus, sortBooks } from "../src/lib/libraryView";

let failed = 0;
function check(name: string, ok: boolean) {
  if (ok) console.log(`  ok  ${name}`);
  else {
    failed++;
    console.error(`FAIL  ${name}`);
  }
}

const books = [
  { Title: "The Left Hand of Darkness", Attribution: "Ursula K. Le Guin", ReadStatus: 2 },
  { Title: "Ancillary Justice", Attribution: "Ann Leckie", ReadStatus: 1 },
  { Title: "Unnamed draft", Attribution: "", ReadStatus: 0 }
];

check("query matches title case-insensitively", filterBooks(books, "justice", "all").length === 1);
check("query matches author", filterBooks(books, "le guin", "all").length === 1);
check("blank query keeps all", filterBooks(books, "   ", "all").length === 3);
check("reading filter => only ReadStatus 1", filterBooks(books, "", "reading").length === 1);
check("finished filter => only ReadStatus 2", filterBooks(books, "", "finished").length === 1);
check("unread filter includes missing ReadStatus", filterBooks([...books, { Title: "No status field" }], "", "unread").length === 2);
check("query and status combine (AND)", filterBooks(books, "ancillary", "finished").length === 0);
check("sort by title", sortBooks(books, "title")[0].Title === "Ancillary Justice");
check("sort by author", sortBooks(books, "author")[0].Attribution === "Ann Leckie");
check("manual sort returns the same reference", sortBooks(books, "manual") === books);
check("nextReadStatus cycles 0->1->2->0", nextReadStatus(0) === 1 && nextReadStatus(1) === 2 && nextReadStatus(2) === 0 && nextReadStatus(undefined) === 1);

if (failed > 0) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
