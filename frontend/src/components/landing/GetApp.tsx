import { Link } from "react-router-dom";

export const APP_STORE_URL = "#";
export const PLAY_STORE_URL = "#";

const gridCovers = ["piranesi", "hail-mary", "circe", "gilead", "achilles", "normal-people"];

function StoreBadge({ href, store, label }: { href: string; store: string; label: string }) {
  return (
    <a
      href={href}
      rel="noreferrer"
      aria-label={`${label} — ${store}`}
      className="inline-flex flex-col rounded-lg bg-(--color-text) px-4 py-2 text-(--color-bg) transition-opacity hover:opacity-90"
    >
      <span className="text-[10px] leading-tight opacity-80">Download on the</span>
      <span className="text-sm font-bold leading-tight">{store}</span>
    </a>
  );
}

export function GetApp() {
  return (
    <section id="app" className="scroll-mt-14 border-t border-(--color-border)">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 lg:grid-cols-2 lg:py-24">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-(--color-text-dim)">
            <span aria-hidden className="h-px w-4 bg-(--color-accent)" />
            Get the app
          </p>
          <h2 className="mt-3 text-3xl font-bold sm:text-4xl" style={{ fontFamily: '"Playfair Display", serif' }}>
            Your library, in your pocket
          </h2>
          <p className="text-pretty mt-3 text-lg text-(--color-text-dim)">
            The mobile app puts your shelves, murals and arena votes in your
            pocket — or keep using Scripta right in the browser.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <StoreBadge href={APP_STORE_URL} store="App Store" label="Get Scripta on the App Store" />
            <StoreBadge href={PLAY_STORE_URL} store="Google Play" label="Get Scripta on Google Play" />
          </div>
          <p className="mt-4 text-sm text-(--color-text-dim)">
            Prefer the browser?{" "}
            <Link
              to="/login?mode=signup"
              className="font-semibold text-(--color-text) underline decoration-(--color-accent) decoration-2 underline-offset-4 hover:decoration-4"
            >
              Use Scripta on the web
            </Link>
            .
          </p>
        </div>
        <div className="flex justify-center">
          <div className="w-56 rounded-[2.5rem] border-2 border-(--color-border) bg-(--color-surface) p-3">
            <div className="overflow-hidden rounded-[2rem] bg-(--color-bg)">
              <div className="flex h-8 items-center justify-center border-b border-(--color-border) text-xs font-bold">
                Scripta
              </div>
              <div className="grid grid-cols-3 gap-1.5 p-2">
                {gridCovers.map((cover) => (
                  <img key={cover} src={`/covers/${cover}.jpg`} alt="" loading="lazy" className="aspect-[2/3] rounded-md object-cover" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
