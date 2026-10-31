import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { Duel } from "@scripta/shared";
import { DuelCard } from "../src/components/arena/DuelCard";
import { MuralThumb } from "../src/components/murals/MuralThumb";
import { QUIZ_TYPE_LABELS } from "../src/lib/quizTypeLabels";
import { PANEL_HEADER } from "../src/components/page/surfaceClasses";

const src = (f: string) => readFileSync(new URL(`../src/${f}.tsx`, import.meta.url), "utf8");

const side = (title: string, workId: string | null = title) => ({ workId, title, author: "Someone", cover: null, votes: 0 });
const duel: Duel = { id: "d0", roundNumber: 1, duelIndex: 0, bookA: side("Alpha"), bookB: side("Beta", null), winnerWorkId: null, status: "active", opensAt: "2026-10-25T00:00:00Z", closesAt: "2026-10-26T00:00:00Z", hasVoted: false };

function duelHtml(round: string) {
  return renderToString(createElement(MemoryRouter, null, createElement(DuelCard, { duel, round, onVote: () => undefined, votingDisabledReason: null, onAddBook: () => undefined })));
}

test("a duel card is headed with the bracket's own round name", () => {
  assert.match(duelHtml("Semis"), />Semis<!-- --> · Duel <!-- -->1</);
  assert.doesNotMatch(duelHtml("Semis"), /Round 1/);
  const tree = src("components/arena/BracketTree");
  assert.equal(tree.match(/renderDuel\(duel\.id, labelFor\(duel\.roundNumber\)\)/g)?.length, 2);
  assert.match(src("pages/ArenaViewPage"), /<DuelCard\s+duel=\{duel\}\s+round=\{round\}/);
});

test("About and Add sit under the cover as labelled 44px targets, never over it", () => {
  const html = duelHtml("Round 1");
  assert.match(html, /<a(?=(?:=>|[^>])*aria-label="About this book")(?=(?:=>|[^>])*min-h-11)(?:=>|[^>])*>About<\/a>/);
  assert.match(html, /<button(?=(?:=>|[^>])*aria-label="Add Alpha to your library")(?=(?:=>|[^>])*min-h-11)(?:=>|[^>])*>Add<\/button>/);
  assert.doesNotMatch(html, /absolute right-0 top-0|absolute left-0 top-0/);
  assert.equal(html.match(/aria-label="About this book"/g)?.length, 1);
});

test("the feed card's footer is one row: like and comments left, Save, Want to read and Share right", () => {
  const card = src("components/home/FeedCard");
  assert.doesNotMatch(card, /BUTTON_SECONDARY/);
  const footer = card.slice(card.indexOf("{threaded || ref || wantable || shareable"));
  assert.match(footer, /ml-auto flex items-center gap-1[\s\S]*aria-label="Save"[\s\S]*Want to read[\s\S]*Share \$\{title/);
  assert.equal(card.match(/aria-label="Save"/g)?.length, 1);
  const header = card.slice(card.indexOf("<article"), card.indexOf("{item.kind === \"follow\" ? null"));
  assert.doesNotMatch(header, /aria-label="Save"/);
});

test("a mural card shows its title and a preview in the mural's own theme", () => {
  const card = src("components/home/FeedCard");
  assert.match(card, /<MuralThumb theme=\{item\.mural\.theme\} coverUrl=\{item\.mural\.coverImageUrl\}/);
  assert.doesNotMatch(card, /bg-\(--color-surface-hover\) text-\(--color-accent\)">\s*\{item\.mural/);
});

test("MuralThumb: the cover when there is one, the block layout when there is not, an icon for neither", () => {
  const render = (props: object) => renderToString(createElement(MuralThumb, { theme: "dark", ...props }));
  assert.match(render({ coverUrl: "c.png" }), /<img src="c\.png"/);
  const layouts = [{ x: 0, y: 0, w: 6, h: 2 }, { x: 6, y: 0, w: 6, h: 2 }];
  const blocks = render({ layouts });
  assert.equal(blocks.match(/<span class="absolute rounded-sm border"/g)?.length, 2);
  assert.match(blocks, /left:50%/);
  assert.doesNotMatch(blocks, /<img/);
  assert.match(render({}), /<svg/);
  assert.match(blocks, /background:#/i);
});

test("mural list cards put a preview over the name and one menu style, with no cover-only branches", () => {
  const list = src("pages/MuralsListPage");
  assert.match(list, /<MuralThumb theme=\{mural\.theme\} coverUrl=\{mural\.coverImageUrl\} layouts=\{mural\.blocks\.map\(\(block\) => block\.layout\)\}/);
  assert.doesNotMatch(list, /hasCover/);
});

test("the folder column lines All murals and New folder up with the folder names", () => {
  const tree = src("components/murals/MuralFolderTree");
  assert.match(tree, /const nested = folders\.some\(\(folder\) => folder\.parentId !== null\)/);
  assert.equal(tree.match(/\$\{indent\}/g)?.length, 2);
  assert.match(tree, /!nested \? "hidden"/);
});

test("the three Home side panels share one header band and no hairline under it", () => {
  assert.match(PANEL_HEADER, /px-4\.5/);
  for (const f of ["ForYouPanel", "SuggestedReaders", "ReadingStrip"]) {
    const s = src(`components/home/${f}`);
    assert.match(s, /<div className=\{PANEL_HEADER\}>\s*<h2 id="home-[a-z]+" className=\{PANEL_HEADING\}>/, f);
    assert.doesNotMatch(s, /LIST_PANEL/, f);
  }
});

test("Settings: Library style groups sit under a PANEL_HEADING above their panel, and Preview is a section heading", () => {
  const controls = src("components/StyleControls");
  assert.match(controls, /<h2 className=\{`\$\{PANEL_HEADING\} mb-3`\}>\{title\}<\/h2>\s*\}\s*<div className=\{`\$\{PANEL\} p-4`\}>/);
  assert.doesNotMatch(controls, /<h4/);
  const style = src("pages/LibraryStylePage");
  assert.match(style, /<h2 className=\{`\$\{SECTION_HEADING\} mb-3`\}>\s*Preview/);
  assert.match(style, /className=\{`\$\{BUTTON_SECONDARY\} mb-8`\}/);
});

test("Settings password fields use the shared field class, not the grey page-coloured default", () => {
  assert.equal(src("auth/AccountSecuritySection").match(/<PasswordInput className=\{PASSWORD_FIELD\}/g)?.length, 3);
  assert.match(src("auth/AccountSecuritySection"), /const PASSWORD_FIELD = `\$\{FIELD_CLASS\} w-full`/);
  assert.match(src("auth/DeleteAccountSection"), /<PasswordInput className=\{`\$\{FIELD_CLASS\} w-full`\}/);
});

test("Delete account names quizzes and comments", () => {
  assert.match(src("auth/DeleteAccountSection"), /tournaments, quizzes, comments, follows and connected accounts/);
});

test("destructive buttons are danger buttons", () => {
  assert.match(src("pages/LibraryPage"), /className=\{BUTTON_DANGER\}\s*>\s*Delete selected/);
  assert.match(src("pages/GroupsPage"), /className=\{BUTTON_DANGER\}\s*>\s*Delete selected/);
  assert.match(src("pages/QuizEditorPage"), /className=\{BUTTON_DANGER_OUTLINE\}\s*>\s*Delete\s*</);
});

test("the quiz editor and the wizard name question types the same way", () => {
  assert.equal(QUIZ_TYPE_LABELS.cover_title, "Guess the title from a blurred cover");
  for (const f of ["pages/QuizEditorPage", "pages/QuizCreatePage"]) {
    const s = src(f);
    assert.match(s, /import \{ QUIZ_TYPE_LABELS \} from "\.\.\/lib\/quizTypeLabels"/, f);
    assert.doesNotMatch(s, /const TYPE_LABELS/, f);
  }
  assert.doesNotMatch(src("pages/QuizEditorPage"), /Blurred cover →/);
});

test("the new series / collection field: danger frame on error, Add and Cancel buttons that keep focus", () => {
  const s = src("pages/GroupsPage");
  assert.match(s, /draftError \? "border-\(--color-danger\)" : "border-\(--color-accent\)"/);
  assert.match(s, /aria-invalid=\{draftError \? true : undefined\}/);
  assert.match(s, /<button type="button" onMouseDown=\{\(e\) => e\.preventDefault\(\)\} onClick=\{\(\) => void handleCommitDraft\(true\)\} className=\{BUTTON_PRIMARY\}>\s*Add\s*</);
  assert.match(s, /onClick=\{cancelDraft\} className=\{BUTTON_SECONDARY\}>\s*Cancel\s*</);
  assert.match(s, /contains\(e\.relatedTarget\)/);
  assert.doesNotMatch(s, /Press Enter to add it/);
});

test("section headings: Published, day groups, Your chapters and the Admin groups use SECTION_HEADING", () => {
  assert.match(src("pages/CommunityProfilePage"), /<h2 className=\{`\$\{SECTION_HEADING\} mb-3`\}>Published<\/h2>/);
  assert.match(src("pages/DailyChapterPage"), /<h2 id="daily-history" className=\{SECTION_HEADING\}>Your chapters<\/h2>/);
  const admin = src("pages/AdminDailyChapterPage");
  assert.equal(admin.match(/<h2 className=\{SECTION_HEADING\}>/g)?.length, 6);
  assert.doesNotMatch(admin, /<h2 className="text-xl">/);
  const activity = src("components/ProfileActivity");
  assert.match(activity, /<h2 className=\{`\$\{SECTION_HEADING\} mb-3`\}>\{day\}<\/h2>\s*<div className=\{LIST_PANEL\}>/);
  assert.match(activity, /<Link to=\{target\} className=\{LIST_ROW_LINK\}>/);
});

test("the owner's tier list ticket shows its state and size", () => {
  const s = src("pages/ArenaListPage");
  assert.match(s, /badges=\{<StatusBadge \{\.\.\.tierlistStatus\(tl\)\} \/>\}/);
  assert.match(s, /stats=\{\[\{ value: tl\.data\.pool\.length/);
  assert.match(s, /tl\.voteCode === null\) return \{ label: "Draft"/);
});

test("the book meta line keeps its separators with the next item, so none dangles at a wrap", () => {
  const s = src("components/book/BookScreen");
  assert.match(s, /overflow-hidden text-sm[\s\S]*?-ml-5 flex flex-wrap[\s\S]*?pl-5 before:absolute before:left-2 before:content-\['·'\]/);
  assert.doesNotMatch(s, /key=\{`dot-/);
});
