import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { gzipSync } from "node:zlib";

const RAILWAY = ["ssh", "--project", "404b0e4a-701b-47ea-83fc-a82a80ae5094", "--environment", "39833834-0e18-4dde-a57f-3bf0bf0bab51", "--service", "scripta", "--"];
const CHUNK = 90_000;

const split = process.argv.indexOf("--");
const files = process.argv.slice(2, split === -1 ? undefined : split);
const args = split === -1 ? [] : process.argv.slice(split + 1);
if (files.length === 0) {
  console.error("Usage: node backend/scripts/search-scorecard/prod.mjs <script.mjs> [data files…] [-- args; {dir} is the upload directory]");
  process.exit(1);
}
const remote = (command, stdio = ["ignore", "pipe", "inherit"]) => execFileSync("railway", [...RAILWAY, "sh", "-c", command], { stdio, maxBuffer: 1 << 30 });
const dir = `/tmp/scorecard-${randomBytes(4).toString("hex")}`;
try {
  remote(`mkdir -p ${dir}`);
  for (const file of files) {
    const name = basename(file);
    const packed = (name.endsWith(".gz") ? readFileSync(file) : gzipSync(readFileSync(file))).toString("base64");
    for (let at = 0; at < packed.length; at += CHUNK) remote(`printf %s '${packed.slice(at, at + CHUNK)}' >> ${dir}/${name}.b64`);
    remote(`base64 -d ${dir}/${name}.b64 ${name.endsWith(".gz") ? `> ${dir}/${name}` : `| gunzip > ${dir}/${name}`} && rm ${dir}/${name}.b64`);
  }
  const main = `${dir}/${basename(files[0])}`;
  const quoted = args.map((arg) => `'${arg.replaceAll("{dir}", dir).replaceAll("'", "'\\''")}'`).join(" ");
  remote(`node ${main} ${quoted}`, ["ignore", "inherit", "inherit"]);
} finally {
  remote(`rm -rf ${dir}`);
}
