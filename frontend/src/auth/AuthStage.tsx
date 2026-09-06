// Shared backdrop for every screen in the sign-up/sign-in journey
// (LoginPage, ChooseUsernamePage, WelcomeAvatarPage): the app's fixed dark
// "cover" stage — near-black ground, faint inverted watermark, paper ink —
// with the working form sitting in an elevated card on top. The cover
// identity stays fixed regardless of the OS light/dark preference (same
// reasoning LoginPage has always carried); the card is what makes these
// working screens read as conventional forms rather than title pages.

import { useEffect, useState, type ReactNode } from "react";

export const INK = "#0d0c0b";
export const PAPER = "#f2ede6";
export const PAPER_DIM = "rgba(242, 237, 230, 0.65)";
export const PAPER_FAINT = "rgba(242, 237, 230, 0.18)";
export const CARD = "#171310";
export const CARD_BORDER = "rgba(242, 237, 230, 0.12)";
export const GOLD = "#e08a52";

// logo.png's actual pixel dimensions — needed to compute a *capped* cover
// size (a plain CSS `background-size: cover` has no ceiling: on a window
// shape very different from the image's own aspect ratio, it scales the
// artwork up past the point of being recognizable as anything but abstract
// texture).
const LOGO_NATURAL_WIDTH = 992;
const LOGO_NATURAL_HEIGHT = 1070;
const LOGO_MAX_SCALE = 1.7;

function useCappedCoverSize() {
  function compute() {
    if (typeof window === "undefined") return { width: LOGO_NATURAL_WIDTH, height: LOGO_NATURAL_HEIGHT };
    const coverScale = Math.max(window.innerWidth / LOGO_NATURAL_WIDTH, window.innerHeight / LOGO_NATURAL_HEIGHT);
    const scale = Math.min(coverScale, LOGO_MAX_SCALE);
    return { width: LOGO_NATURAL_WIDTH * scale, height: LOGO_NATURAL_HEIGHT * scale };
  }

  const [size, setSize] = useState(compute);

  useEffect(() => {
    function handleResize() {
      setSize(compute());
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return size;
}

export function AuthStage({ children }: { children: ReactNode }) {
  const bgSize = useCappedCoverSize();

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-12" style={{ backgroundColor: INK, color: PAPER }}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 select-none"
        style={{
          backgroundImage: "url(/logo.png)",
          backgroundSize: `${bgSize.width}px ${bgSize.height}px`,
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          filter: "invert(1) brightness(1.1)",
          opacity: 0.07
        }}
      />
      <div className="relative z-10 w-full max-w-[400px]">{children}</div>
    </div>
  );
}

export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div
      className="rounded-2xl p-6 sm:p-8"
      style={{ backgroundColor: CARD, border: `1px solid ${CARD_BORDER}`, boxShadow: "0 12px 40px rgba(0, 0, 0, 0.5)" }}
    >
      {children}
    </div>
  );
}

export function AuthBrandHeading({ subtitle }: { subtitle: string }) {
  return (
    <div className="mb-6 text-center">
      <h1
        className="text-2xl tracking-[0.12em]"
        style={{ color: PAPER, fontFamily: "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif" }}
      >
        Scripta
      </h1>
      <p className="mt-2 text-[12px]" style={{ color: PAPER_DIM }}>
        {subtitle}
      </p>
    </div>
  );
}

// Standard box input for auth forms: quiet 1px border, faint fill, and the
// hairline focus treatment — 1px gold border swap plus a tight 2px ring at
// low opacity (no blur, no glow). Pure CSS :focus styling; none of the old
// manual onFocus/onBlur border juggling.
const fieldBase =
  "w-full rounded-lg bg-[rgba(242,237,230,0.05)] px-3 py-2.5 text-[14px] text-[#f2ede6] outline-none transition-shadow border focus:border-[#e08a52] focus:ring-2 focus:ring-[#e08a52]/15";
export const authFieldClass = `${fieldBase} border-[rgba(242,237,230,0.15)]`;
export const authFieldErrorClass = `${fieldBase} border-[#c96a52]`;

export function AuthFieldError({ id, message }: { id: string; message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1.5 text-[11px]" style={{ color: "#e3a292" }}>
      {message}
    </p>
  );
}

export const authLabelClass = "mb-1.5 block text-[10px] font-semibold tracking-[0.14em] uppercase";

export function AuthServerError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="mb-5 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: "rgba(201, 106, 82, 0.14)", color: "#e3a292" }} role="alert">
      {message}
    </div>
  );
}

export const authSubmitClass =
  "w-full rounded-lg py-2.5 text-sm font-semibold transition-colors disabled:opacity-50";
