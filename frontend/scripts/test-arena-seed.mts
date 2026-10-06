import { seedCoverLookup, toSeedBook } from "../../packages/shared/dist/arena/index.js";

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

console.log("1. Seed books preserve the existing shape");
{
  const seed = toSeedBook({
    _workId: "w1",
    ISBN: "978-1-4028-9462-6",
    Title: "  The Book  ",
    Attribution: "  An Author  "
  }, "https://covers.example/resolved.jpg");
  check("resolved cover is accepted as an argument", JSON.stringify(seed) === JSON.stringify({
    workId: "w1",
    title: "  The Book  ",
    author: "  An Author  ",
    cover: "https://covers.example/resolved.jpg"
  }), JSON.stringify(seed));

  const empty = toSeedBook({ _workId: "w2" }, null);
  check("fallback fields and work id are stable", JSON.stringify(empty) === JSON.stringify({
    workId: "w2",
    title: "Untitled",
    author: "Unknown author",
    cover: null
  }), JSON.stringify(empty));
}

console.log("\n1b. A book without a work cannot be seeded");
check("no work id gives no seed book", toSeedBook({ Title: "Orphan" }, null) === null);

console.log("\n2. Cover lookups normalize identifiers and trim search titles");
{
  const lookup = seedCoverLookup({
    ISBN: "978-1-4028-9462-6",
    ImageId: "ABCDEF12-3456-7890-ABCD-EF1234567890",
    Title: "  The Book  ",
    Attribution: "An Author"
  });
  check("lookup fields stay unchanged", JSON.stringify(lookup) === JSON.stringify({
    isbn: "9781402894626",
    imageId: "ABCDEF12-3456-7890-ABCD-EF1234567890",
    title: "The Book",
    author: "An Author"
  }), JSON.stringify(lookup));
  check("missing metadata skips the lookup", seedCoverLookup({}) === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
