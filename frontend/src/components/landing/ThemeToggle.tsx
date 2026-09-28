import { resolveTheme, themes } from "@scripta/shared/themes";
import { applyThemePreference, osScheme, useThemePreference } from "../../lib/theme";

function SunIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
    </svg>
  );
}

export function ThemeToggle() {
  const scheme = themes[resolveTheme(useThemePreference(), osScheme())].scheme;

  return (
    <button
      type="button"
      onClick={() => applyThemePreference(scheme === "dark" ? "light" : "dark")}
      aria-label={scheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-(--color-border) text-(--color-text-dim) transition-colors hover:bg-(--color-surface-hover) hover:text-(--color-text)"
    >
      {scheme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
