import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { DEFAULT_READER_CARD_STYLE, publicStyle, readerCardInputOf, type Layout, type PublicReaderCard } from "@scripta/shared";
import { ReaderCardImage } from "../src/components/readerCard/ReaderCardImage";
import { ReaderCardTurner } from "../src/components/readerCard/ReaderCardTurner";
import { ReaderCardViewer } from "../src/components/readerCard/ReaderCardViewer";

const card: PublicReaderCard = {
  state: "settled", identity: "star", runnerUp: null, streak: "lamp", signal: null, coverage: ["genres known for 3 of 3 finished books"],
  dial: { segments: [{ group: "star", books: 3, marked: 1 }] },
  facts: { finished: 3, highlights: 2, series: 0, since: 2020, edition: 2026 },
  style: { ...publicStyle(DEFAULT_READER_CARD_STYLE), counter: "dial", layout: "faces", trait: "both" },
  chosen: { highlight: { text: "To light a candle", title: "A Wizard of Earthsea", author: "Ursula K. Le Guin" } },
};
const visitor = (layout: Layout, fields: Partial<PublicReaderCard> = {}) => readerCardInputOf([], [], "andre", { ...card, ...fields, style: { ...publicStyle(DEFAULT_READER_CARD_STYLE), counter: "dial", layout, trait: "both" } });
const viewer = (input: ReturnType<typeof visitor>) => renderToString(createElement(ReaderCardViewer, { input, onClose: () => undefined }));

test("the image draws both prints, each hidden by the other theme", () => {
  const html = renderToString(createElement(ReaderCardImage, { input: visitor("faces") }));
  assert.equal(html.match(/<svg /g)?.length, 2);
  assert.match(html, /dark:hidden/);
  assert.match(html, /hidden h-full w-full dark:block/);
});

test("the viewer is a modal dialog that announces its page and carries the card as text", () => {
  const html = viewer(visitor("faces"));
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-live="polite"[^>]*>Page 1 of 3</);
  assert.match(html, /To light a candle/);
  assert.equal(html.match(/aria-label="Page \d"/g)?.length, 3);
});

test("merged has two faces, and a visitor with nothing chosen skips the chosen page", () => {
  assert.match(viewer(visitor("merged")), />Page 1 of 2</);
  assert.match(viewer(visitor("faces", { chosen: {} })), />Page 1 of 2</);
});

test("a book on a narrow screen is a pager of every page", () => {
  const html = viewer(visitor("book"));
  assert.match(html, />Page 1 of 3</);
  assert.match(html, /snap-x/);
});

test("the page dots are white on the scrim, whatever the theme's surface is", () => {
  const html = viewer(visitor("faces"));
  const dots = html.slice(html.indexOf('aria-label="Pages"'));
  assert.match(dots, /rounded-full bg-white"/);
  assert.match(dots, /rounded-full bg-white\/40"/);
  assert.doesNotMatch(dots, /bg-\(--color-surface\)/);
});

test("the turner is inline: no dialog, and off the scrim its dots take the page's text colour", () => {
  const html = renderToString(createElement(ReaderCardTurner, { input: visitor("faces"), cardWidth: "w-64", spreadWidth: "w-full" }));
  assert.doesNotMatch(html, /role="dialog"/);
  assert.match(html, />Page 1 of 3</);
  const dots = html.slice(html.indexOf('aria-label="Pages"'));
  assert.match(dots, /bg-\(--color-text\)/);
  assert.doesNotMatch(dots, /bg-white/);
});

test("only the owner's viewer offers Edit card, and only when it can go somewhere", () => {
  const owner = readerCardInputOf([], [], "andre");
  const noop = () => undefined;
  assert.match(renderToString(createElement(ReaderCardViewer, { input: owner, onClose: noop, onEdit: noop })), />Edit card</);
  assert.doesNotMatch(renderToString(createElement(ReaderCardViewer, { input: owner, onClose: noop })), /Edit card/);
  assert.doesNotMatch(renderToString(createElement(ReaderCardViewer, { input: visitor("faces"), onClose: noop, onEdit: noop })), /Edit card/);
});
