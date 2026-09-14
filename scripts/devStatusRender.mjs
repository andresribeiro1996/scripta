export function formatTable(headers, rows) {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => String(row[column] ?? "").length)),
  );
  const line = (cells) => ` ${cells.map((cell, column) => String(cell ?? "").padEnd(widths[column])).join(" ")}`;
  return [line(headers), ...rows.map(line)].join("\n");
}

function minutes(ms) {
  return `${Math.round(ms / 60000)}m`;
}

function clockTime(iso) {
  return iso ? new Date(iso).toTimeString().slice(0, 5) : "—";
}

export function renderStatus(status) {
  const { host, stacks, devices, limits, warnings } = status;
  const headroomGB = (host.freeBytes - limits.minFreeBytes) / 1024 ** 3;
  const floorGB = (limits.minFreeBytes / 1024 ** 3).toFixed(0);

  const sections = [
    `scripta dev · ${host.lanAddress ?? "no LAN address"} · ${host.totalMemGB} GB total, ${host.freeMemGB} GB free · load ${host.loadAvg1.toFixed(1)} / ${host.cores} cores`,
    "",
  ];

  if (stacks.length === 0) {
    sections.push(" no stacks running.", "");
  } else {
    sections.push(
      formatTable(
        ["SLOT", "BRANCH", "SESSION", "API", "WEB", "METRO", "RSS", "CPU"],
        stacks.map((stack) => [
          stack.state === "stale" ? `${stack.slot} stale` : String(stack.slot),
          stack.branch,
          stack.session ?? "—",
          String(stack.ports.backend),
          String(stack.ports.vite),
          String(stack.ports.metro),
          `${stack.rssTotalMB} MB`,
          `${stack.cpuTotal}%`,
        ]),
      ),
      "",
    );
  }

  sections.push(
    formatTable(
      ["DEVICE", "SERIAL", "HELD BY", "SINCE"],
      devices.map((device) =>
        device.holder
          ? [device.avd, device.serial ?? "—", device.holder, `${clockTime(device.takenAt)} (${minutes(device.heldMs)})`]
          : [device.avd, "—", "free", "—"],
      ),
    ),
    "",
    ` ${stacks.length} of ${limits.maxStacks} stacks · ${headroomGB.toFixed(1)} GB above the ${floorGB} GB floor`,
  );

  if (warnings.length > 0) {
    sections.push("", ...warnings.map((warning) => ` warning: ${warning}`));
  }
  return `${sections.join("\n")}\n`;
}

export function renderWorktree(status, worktreePath) {
  const stack = status.stacks.find((candidate) => candidate.worktree === worktreePath);
  if (stack === undefined) {
    return ` ${worktreePath} holds no slot — run \`npm run dev:claim\` to take one.\n`;
  }
  const { urls } = stack;
  return [
    ` ${stack.branch} · slot ${stack.slot}${stack.state === "stale" ? " (stale)" : ""}`,
    "",
    `   web,  this laptop   ${urls.webLocal}`,
    `   web,  phone         ${urls.webLan ?? "unavailable — no LAN address"}`,
    `   app,  phone         ${urls.expoLan ?? "unavailable — no LAN address"}`,
    `   app,  emulator      ${urls.expoEmulator}   (needs adb reverse tcp:${stack.ports.metro})`,
    "",
  ].join("\n");
}
