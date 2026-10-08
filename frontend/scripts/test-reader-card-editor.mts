import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DEFAULT_FEED_SETTINGS } from "@scripta/shared/community";
import type { ThemeScheme } from "@scripta/shared/themes";
import { DEFAULT_READER_CARD_STYLE, MOTTO_MAX, bookKey, readerCardInputOf } from "@scripta/shared";
import { HighlightChoice, SignatureChoice } from "../src/components/readerCard/ReaderCardChoices";
import { ReaderCardOptions } from "../src/components/readerCard/ReaderCardOptions";
import { ReaderGlyphSetting } from "../src/components/readerCard/ReaderGlyphSetting";
import { ToastProvider } from "../src/components/Toaster";

const books = Array.from({ length: 6 }, (_, i) => ({ Title: `Book ${i}`, Attribution: `Author ${i}`, ReadStatus: 2, _genres: ["Fantasy"] }));
const group = (html: string, label: string) => {
  const start = html.indexOf(`aria-label="${label}"`);
  return html.slice(start, html.indexOf("</div>", start));
};
const options = (style = {}, scheme: ThemeScheme = "light") => renderToString(createElement(ReaderCardOptions, { scheme, input: readerCardInputOf(books, [], "andre.ribeiro", undefined, { style: { ...DEFAULT_READER_CARD_STYLE, counter: "beads", trait: "seal", layout: "book", ...style }, coverOf: () => null }), onChange: async () => true }));

test("five counter thumbnails, with only the chosen one checked", () => {
  const counters = group(options(), "Counter");
  assert.equal(counters.match(/role="radio"/g)?.length, 5);
  assert.equal(counters.match(/aria-checked="true"/g)?.length, 1);
  assert.match(counters, /aria-checked="true"[^>]*>(?:(?!<\/button>).)*Beads/s);
});

test("trait and layout show their names and press the current one", () => {
  const html = options();
  for (const name of ["Both", "Seal", "Line", "None", "Three faces", "Book", "One back"]) assert.match(html, new RegExp(`>${name}<`));
  assert.match(html, /aria-pressed="true"[^>]*>Seal</);
  assert.match(html, /aria-pressed="true"[^>]*>Book</);
});

test("twelve motto looks, checked on the stored one, under a 28-character field", () => {
  const html = options({ motto: { text: "Per libros", look: "arc" } });
  const looks = group(html, "Motto look");
  assert.equal(looks.match(/role="radio"/g)?.length, 12);
  assert.match(looks, /aria-checked="true"[^>]*>(?:(?!<\/button>).)*Arc/s);
  assert.match(html, new RegExp(`maxLength="${MOTTO_MAX}"`, "i"));
  assert.match(html, /value="Per libros"/);
});

test("both footer corners offer twelve chips and check the stored ones", () => {
  const html = options({ footer: { left: "since", right: "initials" } });
  for (const [label, checked] of [["Footer left", "Reader since"], ["Footer right", "Initials"]] as const) {
    const chips = group(html, label);
    assert.equal(chips.match(/role="radio"/g)?.length, 12, label);
    assert.match(chips, new RegExp(`aria-checked="true"[^>]*>${checked}<`), label);
  }
});

test("twelve corner thumbnails and the three prints", () => {
  const html = options({ corners: "laurel", print: "reversed" });
  const corners = group(html, "Corners");
  assert.equal(corners.match(/role="radio"/g)?.length, 12);
  assert.match(corners, /aria-checked="true"[^>]*>(?:(?!<\/button>).)*Laurel/s);
  assert.match(corners, /viewBox="0 0 100 100"/);
  assert.match(html, /aria-pressed="true"[^>]*>Reversed</);
  for (const name of ["Theme", "Paper"]) assert.match(html, new RegExp(`>${name}<`));
});

test("under Theme each thumbnail renders the print of the app theme", () => {
  const light = group(options({ print: "auto" }, "light"), "Corners");
  const dark = group(options({ print: "auto" }, "dark"), "Corners");
  assert.equal(light.match(/<svg/g)?.length, 12);
  assert.equal(dark.match(/<svg/g)?.length, 12);
  assert.match(light, /#f1eadb/);
  assert.doesNotMatch(dark, /#f1eadb/);
});

const save = async () => true;
const finished = { Title: "A Wizard of Earthsea", Attribution: "Ursula K. Le Guin", ReadStatus: 2, highlights: [{ Type: "highlight", Text: "To light a candle", BookmarkID: "h1" }] };

test("a reader with no finished books is told how to get a signature book", () => {
  assert.match(renderToString(createElement(SignatureChoice, { books: [{ Title: "Reading", ReadStatus: 1 }], signature: null, onChange: save })), /Finish a book to choose your signature book\./);
});

test("the chosen signature book shows with its note, capped at sixty characters", () => {
  const html = renderToString(createElement(SignatureChoice, { books: [finished], signature: { bookKey: bookKey(finished), note: "lent twice" }, chosen: { title: "A Wizard of Earthsea", author: "Ursula K. Le Guin", workId: null, coverUrl: null, note: "lent twice" }, onChange: save }));
  assert.match(html, /A Wizard of Earthsea/);
  assert.match(html, /value="lent twice"/);
  assert.match(html, /maxLength="60"/i);
  assert.match(html, />10\/60</);
  assert.match(html, />Change</);
  assert.match(html, />Remove</);
});

test("a stored choice the library lost says so and can be removed", () => {
  const book = renderToString(createElement(SignatureChoice, { books: [finished], signature: { bookKey: "isbn:gone", note: null }, onChange: save }));
  assert.match(book, /No longer in your library\./);
  assert.match(book, />Remove</);
  const quote = renderToString(createElement(HighlightChoice, { books: [finished], highlight: { bookKey: "isbn:gone", highlightId: "x" }, onChange: save }));
  assert.match(quote, /No longer in your library\./);
});

test("a reader with no Kobo highlights is told so; a chosen highlight shows as a quote", () => {
  assert.match(renderToString(createElement(HighlightChoice, { books: [{ Title: "Notes only", highlights: [{ Type: "note", Text: "mine", BookmarkID: "n1" }] }], highlight: null, onChange: save })), /No Kobo highlights yet\./);
  const html = renderToString(createElement(HighlightChoice, { books: [finished], highlight: { bookKey: bookKey(finished), highlightId: "h1" }, chosen: { text: "To light a candle", title: "A Wizard of Earthsea", author: "Ursula K. Le Guin" }, onChange: save }));
  assert.match(html, /“To light a candle”/);
});

test("the glyph switch reads the profile and says it waits for a published shelf", () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.setQueryData(["community", "own-profile"], { muralId: null, published: false, feedSettings: { ...DEFAULT_FEED_SETTINGS, readerGlyph: true } });
  const html = renderToString(createElement(QueryClientProvider, { client }, createElement(ToastProvider, null, createElement(ReaderGlyphSetting, { username: "andre", books: [], groups: [] }))));
  assert.match(html, /role="switch"[^>]*aria-checked="true"/);
  assert.match(html, /It shows once your shelf is published\./);
});

test("the glyph switch is gone from the shelf's profile sheet", () => {
  assert.doesNotMatch(readFileSync("src/components/OwnShelfView.tsx", "utf8"), /readerGlyph/);
});

test("the editor has its route and a way in from Settings", () => {
  assert.match(readFileSync("src/App.tsx", "utf8"), /path="\/dashboard\/reader-card" element={<ReaderCardPage \/>}/);
  assert.match(readFileSync("src/pages/SettingsPage.tsx", "utf8"), /to="\/dashboard\/reader-card"/);
});

test("the toggle only animates when motion is allowed", () => {
  const source = readFileSync("src/components/ToggleSwitch.tsx", "utf8");
  assert.doesNotMatch(source, /(?<!motion-safe:)transition-/);
});

test("the editor's turner sits in a full-width wrapper so its widths resolve", () => {
  assert.match(readFileSync("src/pages/ReaderCardPage.tsx", "utf8"), /<div className="w-full">\s*<ReaderCardTurner /);
});

test("the editor is gated on the cached style, not on the latest fetch failing", () => {
  const source = readFileSync("src/pages/ReaderCardPage.tsx", "utf8");
  assert.doesNotMatch(source, /isError/);
  assert.match(source, /if \(!style\) \{\s*if \(isPending\) return/);
});

test("thumbnails render from a deferred input, and a picked look pairs with the last typed motto", () => {
  const source = readFileSync("src/components/readerCard/ReaderCardOptions.tsx", "utf8");
  assert.match(source, /const deferred = useDeferredValue\(input\)/);
  assert.doesNotMatch(source, /(?:counterThumbnail|styleThumbnail)\(input,/);
  const pick = source.slice(source.indexOf("const pickLook"), source.indexOf("return (", source.indexOf("const pickLook")));
  assert.match(pick, /lastText\.current/);
  assert.doesNotMatch(pick, /motto[.?]/);
});

test("twelve finish thumbnails between corners and print, with the stored one checked", () => {
  const html = options({ finish: "gilt" });
  const finishes = group(html, "Finish");
  assert.equal(finishes.match(/role="radio"/g)?.length, 12);
  assert.match(finishes, /aria-checked="true"[^>]*>(?:(?!<\/button>).)*Gilt edge/s);
  assert.ok(html.indexOf(`aria-label="Corners"`) < html.indexOf(`aria-label="Finish"`) && html.indexOf(`aria-label="Finish"`) < html.indexOf(`aria-label="Print"`));
});
