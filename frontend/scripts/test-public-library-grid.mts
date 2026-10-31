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

test("visitors and the owner see per-book and per-series card styles on the public grid", () => {
  const style = { ...DEFAULT_LIBRARY_STYLE, cardRadius: 5 };
  const seriesStyle = extractPerCardStyle({ ...style, cardRadius: 17 });
  const bookStyle = extractPerCardStyle({ ...style, cardRadius: 31 });
  const library = {
    books: [base("Plain"), { ...base("InSeries"), _key: "k-series" }, { ...base("Own"), _key: "k-own", _style: bookStyle }],
    groups: [{ id: "g1", type: "series", name: "S", bookKeys: ["k-series"], createdAt: "", updatedAt: "", style: seriesStyle }],
    style
  } as unknown as LibraryData;
  const html = renderToString(createElement(MemoryRouter, null, createElement(PublicLibraryGrid, { library })));
  assert.equal(radiusOf(html, "Plain"), "5");
  assert.equal(radiusOf(html, "InSeries"), "17");
  assert.equal(radiusOf(html, "Own"), "31");
});
