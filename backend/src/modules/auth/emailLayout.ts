export type EmailContent = {
  heading: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  footnote?: string;
  tone?: "default" | "danger";
};

const FONT = "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const FONTS_URL = "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap";

const LIGHT = { bg: "#f2f0ec", surface: "#ffffff", text: "#201e1c", dim: "#6b6560", border: "#ddd8d0", accent: "#97532d", onAccent: "#ffffff", danger: "#ae412e" };
const DARK = { bg: "#141210", surface: "#2a2724", text: "#ece8e3", dim: "#a8a199", border: "#45403a", accent: "#e08a52", onAccent: "#141210", danger: "#e08072" };

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const DARK_STYLES = `@media (prefers-color-scheme: dark) {
  .em-bg { background: ${DARK.bg} !important; }
  .em-surface { background: ${DARK.surface} !important; border-color: ${DARK.border} !important; }
  .em-bar { border-top-color: ${DARK.accent} !important; }
  .em-bar-danger { border-top-color: ${DARK.danger} !important; }
  .em-text { color: ${DARK.text} !important; }
  .em-dim { color: ${DARK.dim} !important; }
  .em-link { color: ${DARK.accent} !important; }
  .em-btn { background: ${DARK.accent} !important; }
  .em-btn-text { color: ${DARK.onAccent} !important; }
  .em-mark-light { display: none !important; }
  .em-mark-dark { display: block !important; }
}`;

export function renderEmail({ heading, paragraphs, button, footnote, tone = "default" }: EmailContent, siteUrl: string): { text: string; html: string } {
  const host = new URL(siteUrl).host;
  const markUrl = (file: string) => escapeHtml(new URL(`/email/${file}`, siteUrl).href);
  const text = [heading, ...paragraphs, ...(button ? [button.url] : []), ...(footnote ? [footnote] : []), `Atmyshelf · ${host}`].join("\n\n");

  const body = paragraphs.map((paragraph) => `<p class="em-text" style="margin:0 0 16px;font:16px/1.6 ${FONT};color:${LIGHT.text}">${escapeHtml(paragraph)}</p>`).join("");
  const url = button ? escapeHtml(button.url) : "";
  const action = button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px"><tr><td class="em-btn" style="background:${LIGHT.accent};border-radius:8px"><a class="em-btn-text" href="${url}" style="display:inline-block;padding:13px 26px;font:600 16px ${FONT};color:${LIGHT.onAccent};text-decoration:none">${escapeHtml(button.label)}</a></td></tr></table>` +
      `<p class="em-dim" style="margin:0 0 16px;font:13px/1.5 ${FONT};color:${LIGHT.dim}">Or paste this link into your browser:<br><a class="em-link" href="${url}" style="color:${LIGHT.accent};word-break:break-all">${url}</a></p>`
    : "";
  const note = footnote ? `<p class="em-dim" style="margin:0;font:14px/1.6 ${FONT};color:${LIGHT.dim}">${escapeHtml(footnote)}</p>` : "";
  const barClass = tone === "danger" ? "em-bar-danger" : "em-bar";
  const barColor = tone === "danger" ? LIGHT.danger : LIGHT.accent;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(heading)}</title>
<link href="${FONTS_URL}" rel="stylesheet">
<style>${DARK_STYLES}</style>
</head>
<body class="em-bg" style="margin:0;padding:0;background:${LIGHT.bg}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-bg" style="background:${LIGHT.bg}"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">
<tr><td style="padding:0 4px 18px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:10px;vertical-align:middle"><img class="em-mark-light" src="${markUrl("mark.png")}" width="28" height="28" alt="" style="display:block"><img class="em-mark-dark" src="${markUrl("mark-dark.png")}" width="28" height="28" alt="" style="display:none"></td><td class="em-text" style="vertical-align:middle;font:700 18px ${FONT};color:${LIGHT.text}">Atmyshelf</td></tr></table></td></tr>
<tr><td class="em-surface ${barClass}" style="background:${LIGHT.surface};border:1px solid ${LIGHT.border};border-top:4px solid ${barColor};border-radius:12px;padding:32px 32px 28px">
<h1 class="em-text" style="margin:0 0 18px;font:700 26px/1.2 ${FONT};letter-spacing:-0.02em;color:${LIGHT.text}">${escapeHtml(heading)}</h1>${body}${action}${note}
</td></tr>
<tr><td class="em-dim" style="padding:16px 4px 0;font:12px/1.5 ${FONT};color:${LIGHT.dim}">Atmyshelf · ${escapeHtml(host)}</td></tr>
</table></td></tr></table>
</body>
</html>`;

  return { text, html };
}
