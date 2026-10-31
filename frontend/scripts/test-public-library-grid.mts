import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { PublicLibraryGrid } from "../src/components/PublicLibraryGrid";
import { DEFAULT_LIBRARY_STYLE, extractPerCardStyle } from "../src/lib/libraryStyle";
import type { LibraryData } from "../src/api/library";

const base = (title: string) => ({ Title: title, Attribution: "Author", ISBN: "", ContentID: title });
const radiusOf = (html: string, title: string) => {
  const card = html.split("<div data-own-font").find((chunk) => chunk.includes(`>${title}</h3>`));
  return card?.match(/border-radius:(\d+)px/)?.[1];
};

const style = { ...DEFAULT_LIBRARY_STYLE, cardRadius: 5 };
const seriesStyle = extractPerCardStyle({ ...style, cardRadius: 17 });
const render = (books: Array<Record<string, unknown>>) => {
  const library = {
    books,
    groups: [{ id: "g1", type: "series", name: "S", bookKeys: ["k-series"], createdAt: "", updatedAt: "", style: seriesStyle }],
    style
  } as unknown as LibraryData;
  return renderToString(createElement(MemoryRouter, null, createElement(PublicLibraryGrid, { library })));
};

test("a visitor's grid applies the library style and the series style", () => {
  const html = render([base("Plain"), { ...base("InSeries"), _key: "k-series" }]);
  assert.equal(radiusOf(html, "Plain"), "5");
  assert.equal(radiusOf(html, "InSeries"), "17");
});

test("the own-profile grid also applies a book's own style over its series style", () => {
  const bookStyle = extractPerCardStyle({ ...style, cardRadius: 31 });
  const html = render([base("Plain"), { ...base("InSeries"), _key: "k-series" }, { ...base("Own"), _key: "k-own", _style: bookStyle }, { ...base("OwnInSeries"), _key: "k-series", _style: bookStyle }]);
  assert.equal(radiusOf(html, "Plain"), "5");
  assert.equal(radiusOf(html, "Own"), "31");
  assert.equal(radiusOf(html, "OwnInSeries"), "31");
});
