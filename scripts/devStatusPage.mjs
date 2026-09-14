function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
  });
}

function link(href, label) {
  return href ? `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>` : `<span class="muted">${escapeHtml(label)} unavailable</span>`;
}

function stackCard(stack) {
  return `
    <section class="card${stack.state === "stale" ? " stale" : ""}">
      <h2>${escapeHtml(stack.branch)}</h2>
      <p class="meta">slot ${stack.slot} · ${escapeHtml(stack.session ?? "no session")} · ${stack.rssTotalMB} MB · ${stack.cpuTotal}%${stack.state === "stale" ? " · stale" : ""}</p>
      <ul>
        <li>${link(stack.urls.webLan, "open the web app")}</li>
        <li>${link(stack.urls.expoLan, "open in Expo Go")}</li>
        ${stack.urls.expoLan ? '<li class="muted">if Expo Go reopens a different project, relaunch from here.</li>' : ""}
        <li class="api">API <code>${escapeHtml(stack.urls.apiLan ?? stack.urls.apiLocal)}</code></li>
      </ul>
    </section>`;
}

function deviceRow(device) {
  if (!device.holder) {
    return `<tr><td>${escapeHtml(device.avd)}</td><td>—</td><td class="muted">free</td><td>—</td></tr>`;
  }
  // heldMs is null when a lease's takenAt is present but unparseable
  // (collectDevices's Number.isFinite guard) — that still counts as
  // held, so it gets an em dash duration rather than "NaNm".
  const duration = device.heldMs === null ? "—" : `${Math.round(device.heldMs / 60000)}m`;
  return `<tr><td>${escapeHtml(device.avd)}</td><td>${escapeHtml(device.serial ?? "—")}</td><td>${escapeHtml(device.holder)}</td><td>${duration}</td></tr>`;
}

export function renderPage(status) {
  const { host, stacks, devices, limits, warnings } = status;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>scripta dev</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 16px; font: 16px/1.5 -apple-system, system-ui, sans-serif; }
  .host { font-size: 14px; opacity: .8; margin-bottom: 16px; }
  .card { border: 1px solid rgba(128,128,128,.4); border-radius: 12px; padding: 12px 16px; margin-bottom: 12px; }
  .card.stale { opacity: .55; }
  h2 { font-size: 17px; margin: 0 0 4px; word-break: break-all; }
  .meta { font-size: 13px; opacity: .7; margin: 0 0 8px; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { padding: 6px 0; }
  a { display: inline-block; padding: 12px 4px; }
  code { word-break: break-all; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  td { padding: 6px 4px; border-top: 1px solid rgba(128,128,128,.25); }
  .muted { opacity: .6; }
  .warning { font-size: 14px; padding: 8px 0; }
</style>
</head>
<body>
<p class="host">${escapeHtml(host.lanAddress ?? "no LAN address")} · ${host.freeMemGB} GB free of ${host.totalMemGB} GB · load ${host.loadAvg1.toFixed(1)} / ${host.cores} cores · ${stacks.length} of ${limits.maxStacks} stacks</p>
${stacks.length === 0 ? '<p class="muted">no stacks running.</p>' : stacks.map(stackCard).join("")}
<table>${devices.map(deviceRow).join("")}</table>
${warnings.map((warning) => `<p class="warning">⚠ ${escapeHtml(warning)}</p>`).join("")}
</body>
</html>
`;
}
