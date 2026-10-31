import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const src = (f: string) => readFileSync(new URL(`../src/${f}.tsx`, import.meta.url), "utf8");

test("quiz cover options are named and sized so four fit on screen", () => {
  const play = src("pages/PlayQuizPage");
  assert.match(play, /<button(?=(?:=>|[^>])*aria-label=\{`Cover option \$\{index \+ 1\} of \$\{question\.options\.length\}`\})(?:=>|[^>])*>/);
  assert.match(play, /grid grid-cols-2 gap-3 sm:grid-cols-4/);
});

test("seed slots: a filled slot is named and can be cleared, and the grid is compact", () => {
  const grid = src("components/arena/SeedSlotGrid");
  assert.match(grid, /aria-label=\{slot \? `Slot \$\{i \+ 1\}: \$\{slot\.title\}, change book` : undefined\}/);
  assert.match(grid, /<button(?=(?:=>|[^>])*aria-label=\{`Remove \$\{slot\.title\} from slot \$\{i \+ 1\}`\})(?=(?:=>|[^>])*min-h-11)(?:=>|[^>])*>\s*Remove\s*<\/button>/);
  assert.match(grid, /onChange\(slots\.map\(\(entry, index\) => \(index === i \? null : entry\)\)\)/);
  assert.match(grid, /grid grid-cols-4 gap-3 sm:grid-cols-8/);
});

test("every search box is the shared SearchField", () => {
  for (const f of ["pages/GroupsPage", "components/tierlist/AddBooksSheet", "pages/TierListCreatePage", "components/AddBookModal", "components/murals/pickers", "components/readerCard/ReaderCardChoices"]) {
    assert.match(src(f), /<SearchField /, f);
    assert.doesNotMatch(src(f), /<input[^>]*(?:type="search"|placeholder="Search)/, f);
  }
  assert.match(src("pages/DiscoverPage"), /placeholder="Search games"/);
  assert.doesNotMatch(src("pages/DiscoverPage"), /Search tier lists, tournaments and quizzes"/);
  const toolbar = src("components/Toolbar");
  assert.match(toolbar, /\$\{fill \? "" : "sm:w-85"\}/);
  assert.match(toolbar, /<input ref=\{inputRef\} type="search"/);
});

test("every share surface uses one link row with a secondary Copy and Stop sharing is a danger button", () => {
  for (const f of ["components/ShareModal", "pages/QuizEditorPage", "pages/TierListEditorPage"]) assert.match(src(f), /<ShareLinkRow\b/, f);
  const row = src("components/ShareLinkRow");
  assert.match(row, /<input readOnly aria-label="Share link"/);
  assert.match(row, /BUTTON_SECONDARY/);
  assert.doesNotMatch(src("pages/QuizEditorPage"), /Copy challenge link/);
  assert.match(src("components/ShareModal"), /<button(?=(?:=>|[^>])*className=\{BUTTON_DANGER_OUTLINE\})(?:=>|[^>])*>\s*\{unsharing \? "Stopping…" : "Stop sharing"\}/);
});

test("the 404 and the failed Google sign-in reuse EmptyState", () => {
  assert.match(src("pages/NotFoundPage"), /<EmptyState/);
  assert.match(src("pages/OAuthSuccessPage"), /<EmptyState/);
  assert.doesNotMatch(src("pages/OAuthSuccessPage"), /text-\(--color-danger\)/);
});

test("dates on cards use the shared absolute format", () => {
  for (const f of ["pages/ArenaListPage", "pages/MuralsListPage", "pages/DailyChapterPage", "components/dailyChapter/DailyChapterCard"]) {
    assert.match(src(f), /formatDate\(/, f);
    assert.doesNotMatch(src(f), /toLocaleDateString/, f);
  }
  assert.doesNotMatch(src("pages/DailyChapterPage"), /\{board\.date\}|\{item\.date\}/);
});

test("the mural header keeps its labelled buttons at every width", () => {
  const editor = src("pages/MuralEditorPage");
  assert.doesNotMatch(editor, /sm:hidden|hidden items-center gap-2 sm:flex/);
  for (const label of ["Fullscreen", "Theme", "Share"]) assert.match(editor, new RegExp(`className=\\{BUTTON_SECONDARY\\}\\s*>\\s*${label}\\s*</button>`));
});
