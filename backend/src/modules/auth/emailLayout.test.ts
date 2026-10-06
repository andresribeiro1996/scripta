import assert from "node:assert/strict";
import { test } from "node:test";
import { renderEmail } from "./emailLayout.js";

const site = "https://atmyshelf.com";

test("heading, paragraphs, button label and URL are HTML-escaped", () => {
  const { html } = renderEmail({
    heading: "<b>Hi</b>",
    paragraphs: ["a & b <script>alert(1)</script>"],
    button: { label: "Go <now>", url: "https://atmyshelf.com/x?a=1&b=\"2\"" }
  }, site);
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<b>Hi</b>"));
  assert.ok(html.includes("&lt;b&gt;Hi&lt;/b&gt;"));
  assert.ok(html.includes("a &amp; b &lt;script&gt;"));
  assert.ok(html.includes("Go &lt;now&gt;"));
  assert.ok(html.includes('href="https://atmyshelf.com/x?a=1&amp;b=&quot;2&quot;"'));
});

test("the link appears unchanged in the text part and as an href in the html part", () => {
  const url = "https://atmyshelf.com/reset-password#token=abc123";
  const { text, html } = renderEmail({ heading: "Reset", paragraphs: ["Body"], button: { label: "Reset password", url }, footnote: "Expires soon." }, site);
  assert.ok(text.includes(`\n${url}\n`));
  assert.ok(text.includes("Reset\n\nBody"));
  assert.ok(text.includes("Expires soon."));
  assert.ok(html.includes(`href="${url}"`));
});

test("without a button there is no link or button markup", () => {
  const { text, html } = renderEmail({ heading: "Deleted", paragraphs: ["Gone."] }, site);
  assert.ok(!html.includes("<a "));
  assert.ok(!html.includes("em-btn\""));
  assert.ok(!text.includes("https://atmyshelf.com/"));
});

test("danger tone colours the top bar in the danger colour", () => {
  assert.ok(renderEmail({ heading: "H", paragraphs: [], tone: "danger" }, site).html.includes("border-top:4px solid #ae412e"));
  assert.ok(renderEmail({ heading: "H", paragraphs: [] }, site).html.includes("border-top:4px solid #97532d"));
});

test("dark mode adds a media query and both marks with absolute URLs", () => {
  const { html } = renderEmail({ heading: "H", paragraphs: [] }, "https://app.example.com/ignored/path");
  assert.ok(html.includes("@media (prefers-color-scheme: dark)"));
  assert.ok(html.includes('<meta name="color-scheme" content="light dark">'));
  assert.ok(html.includes('src="https://app.example.com/email/mark.png"'));
  assert.ok(html.includes('src="https://app.example.com/email/mark-dark.png"'));
  assert.ok(/class="em-mark-dark"[^>]*style="display:none"/.test(html));
  assert.ok(html.includes("Atmyshelf · app.example.com"));
});
