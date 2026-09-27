import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const frontendDir = fileURLToPath(new URL("..", import.meta.url));
const backendDir = join(frontendDir, "..", "backend");
const outDir = join(frontendDir, "public", "landing");
const coverCache = join(tmpdir(), "atmyshelf-landing-covers");
const reader = { username: "eleanor", email: "eleanor@example.test", password: "demo-library-2026" };

const books = [
  { slug: "piranesi", title: "Piranesi", author: "Susanna Clarke", status: 2, rating: 5, finished: "2026-02-11", quote: "The Beauty of the House is immeasurable; its Kindness infinite." },
  { slug: "klara", title: "Klara and the Sun", author: "Kazuo Ishiguro", status: 1, percent: 35, coverId: 10648686 },
  { slug: "hail-mary", title: "Project Hail Mary", author: "Andy Weir", status: 1, percent: 62 },
  { slug: "circe", title: "Circe", author: "Madeline Miller", status: 2, rating: 4, finished: "2026-03-02" },
  { slug: "remains", title: "The Remains of the Day", author: "Kazuo Ishiguro", status: 2, rating: 5, finished: "2026-01-19", coverId: 95742 },
  { slug: "bardo", title: "Lincoln in the Bardo", author: "George Saunders", status: 2, rating: 4, finished: "2025-11-30", coverId: 7909378 },
  { slug: "normal-people", title: "Normal People", author: "Sally Rooney", status: 2, rating: 3, finished: "2025-10-14" },
  { slug: "station-eleven", title: "Station Eleven", author: "Emily St. John Mandel", status: 2, rating: 4, finished: "2026-04-22", coverId: 7369961 },
  { slug: "overstory", title: "The Overstory", author: "Richard Powers", status: 1, percent: 18, quote: "The best arguments in the world won't change a person's mind. The only thing that can do that is a good story.", coverId: 8758252 },
  { slug: "gilead", title: "Gilead", author: "Marilynne Robinson", status: 2, rating: 5, finished: "2026-05-09", quote: "Wherever you turn your eyes the world can shine like transfiguration." },
  { slug: "left-hand", title: "The Left Hand of Darkness", author: "Ursula K. Le Guin", status: 0, coverId: 10618463 },
  { slug: "achilles", title: "The Song of Achilles", author: "Madeline Miller", status: 2, rating: 4, finished: "2025-08-03" },
  { slug: "pachinko", title: "Pachinko", author: "Min Jin Lee", status: 0, coverId: 8044605 },
  { slug: "secret-history", title: "The Secret History", author: "Donna Tartt", status: 0, coverId: 744854 },
  { slug: "the-road", title: "The Road", author: "Cormac McCarthy", status: 2, rating: 4, finished: "2025-12-28", coverId: 198120 },
  { slug: "sweetgrass", title: "Braiding Sweetgrass", author: "Robin Wall Kimmerer", status: 0, coverId: 7281575 },
  { slug: "stoner", title: "Stoner", author: "John Williams", status: 2, rating: 5, finished: "2026-06-15", coverId: 8310729 },
  { slug: "atonement", title: "Atonement", author: "Ian McEwan", status: 0, coverId: 8381043 },
  { slug: "sapiens", title: "Sapiens", author: "Yuval Noah Harari", status: 2, rating: 3, finished: "2025-07-21" },
];

const shots = [
  ["library-desktop", "/dashboard/library", 1280, 780],
  ["home-phone", "/dashboard", 390, 760],
];

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer().once("error", reject).listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(url, child, name) {
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`${name} exited with code ${child.exitCode}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${name} did not answer at ${url}`);
}

async function call(api, method, path, body, token) {
  const response = await fetch(api + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw Object.assign(new Error(`${method} ${path}: ${response.status} ${await response.text()}`), { status: response.status });
  return response.json();
}

async function coverFile(slug, coverId) {
  if (!coverId) return join(frontendDir, "public", "covers", `${slug}.jpg`);
  const file = join(coverCache, `${slug}.jpg`);
  if (!existsSync(file)) {
    const response = await fetch(`https://covers.openlibrary.org/b/id/${coverId}-L.jpg`);
    if (!response.ok) throw new Error(`Open Library cover ${coverId}: ${response.status}`);
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }
  return file;
}

async function seed(api) {
  let session;
  try {
    session = await call(api, "POST", "/auth/signup", reader);
  } catch (error) {
    if (error.status !== 409) throw error;
    session = await call(api, "POST", "/auth/login", { identifier: reader.username, password: reader.password });
  }
  const token = session.accessToken;
  const current = await call(api, "GET", "/library", null, token).catch((error) => {
    if (error.status === 404) return null;
    throw error;
  });
  const library = books.map((book) => ({
    ContentID: `demo-${book.slug}`,
    Title: book.title,
    Attribution: book.author,
    ISBN: null,
    ReadStatus: book.status,
    ___PercentRead: book.status === 2 ? 100 : (book.percent ?? 0),
    Rating: book.rating ?? null,
    DateLastRead: book.finished ?? null,
    highlights: book.quote ? [{ BookmarkID: `demo-${book.slug}-0`, Text: book.quote }] : [],
    _coverUrl: `/demo-covers/${book.slug}.jpg`,
  }));
  const style = { cardMinWidth: 150, cardFontFamily: "playfairDisplay", cardRadius: 10, cardFontSize: 14 };
  await call(api, "PUT", "/library", { data: { source: "demo", schema_version: 1, book_count: library.length, books: library, style }, updatedAt: current?.updatedAt }, token);
}

async function webp(page, png) {
  const dataUrl = await page.evaluate(async (src) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d").drawImage(image, 0, 0);
    return canvas.toDataURL("image/webp", 0.78);
  }, `data:image/png;base64,${png.toString("base64")}`);
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

const children = [];
try {
  mkdirSync(coverCache, { recursive: true });
  const [apiPort, appPort] = [await freePort(), await freePort()];
  const api = `http://localhost:${apiPort}`;
  const app = `http://localhost:${appPort}`;
  const vite = join(dirname(createRequire(join(frontendDir, "package.json")).resolve("vite/package.json")), "bin", "vite.js");
  const backend = spawn(process.execPath, ["--import", "tsx", "scripts/three-users.mjs"], {
    cwd: backendDir,
    env: { ...process.env, PORT: String(apiPort), FRONTEND_URL: app },
    stdio: ["ignore", "ignore", "inherit"],
  });
  const frontend = spawn(process.execPath, [vite, "--port", String(appPort), "--strictPort"], {
    cwd: frontendDir,
    env: { ...process.env, VITE_API_URL: api },
    stdio: ["ignore", "ignore", "inherit"],
  });
  children.push(backend, frontend);
  await waitFor(`${api}/health`, backend, "Fixture API");
  await waitFor(app, frontend, "Vite");
  await seed(api);
  const covers = Object.fromEntries(await Promise.all(books.map(async (book) => [book.slug, await coverFile(book.slug, book.coverId)])));

  const browser = await chromium.launch();
  const login = await browser.newPage();
  await login.goto(`${app}/login`);
  await login.fill("#identifier", reader.username);
  await login.fill("#password", reader.password);
  await login.getByLabel("Remember me").check();
  await login.click("button[type=submit]");
  await login.waitForURL(/\/dashboard/);
  const storageState = await login.context().storageState();
  const encoder = await browser.newPage();
  for (const scheme of ["light", "dark"]) {
    for (const [name, path, width, height] of shots) {
      const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, deviceScaleFactor: 1.5, storageState });
      await context.route("**/demo-covers/*", (route) =>
        route.fulfill({ contentType: "image/jpeg", body: readFileSync(covers[new URL(route.request().url()).pathname.split("/").pop().replace(".jpg", "")]) })
      );
      const page = await context.newPage();
      await page.goto(app + path, { waitUntil: "networkidle" });
      await page.evaluate(() => Promise.all([...document.images].map((image) => image.decode().catch(() => undefined))));
      await page.mouse.move(width - 2, 4);
      await page.waitForTimeout(500);
      const file = join(outDir, `${name}-${scheme}.webp`);
      writeFileSync(file, await webp(encoder, await page.screenshot()));
      console.log(`wrote ${file}`);
      await context.close();
    }
  }
  await browser.close();
} finally {
  for (const child of children) child.kill();
}
