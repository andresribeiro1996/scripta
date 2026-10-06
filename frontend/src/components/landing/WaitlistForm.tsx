import { useId, useState } from "react";
import { ApiError } from "../../api/client";
import { joinWaitlist } from "../../api/waitlist";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function WaitlistForm({ label }: { label: string }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const inputId = useId();
  const helpId = useId();

  if (done) {
    return (
      <div
        role="status"
        className="flex w-full max-w-[520px] items-start gap-2.5 rounded-xl border border-(--color-border) bg-(--color-surface)/60 px-4 py-4 text-left text-sm leading-relaxed"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="mt-px shrink-0 text-(--color-accent)"
        >
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
        <span>
          <span className="font-semibold">You’re on the list.</span> We’ll email {done} when Atmyshelf launches.
        </span>
      </div>
    );
  }

  async function submit() {
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setError("Enter a valid email address.");
      return;
    }
    setSubmitting(true);
    try {
      await joinWaitlist(trimmed);
      setDone(trimmed);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) setError("Enter a valid email address.");
      else if (err instanceof ApiError && err.status === 429) setError("Too many tries. Wait a minute and try again.");
      else if (err instanceof ApiError || err instanceof TypeError) setError("Couldn’t add you just now. Try again in a moment.");
      else {
        setError("Couldn’t add you just now. Try again in a moment.");
        throw err;
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="w-full max-w-[520px] text-left"
    >
      <label htmlFor={inputId} className="block text-center text-xs text-(--color-text-dim)">
        {label}
      </label>
      <div className={`group mt-3 flex min-h-14 items-center gap-2 rounded-xl border bg-(--color-surface)/60 p-1.5 motion-safe:transition-[border-color,box-shadow,background-color] motion-safe:duration-300 ${error ? "border-(--color-danger) focus-within:shadow-[0_0_24px_-8px_color-mix(in_srgb,var(--color-danger)_30%,transparent)]" : "border-(--color-border) focus-within:border-(--color-text)/65 focus-within:bg-(--color-surface)/90 focus-within:shadow-[0_0_28px_-8px_color-mix(in_srgb,var(--color-text)_25%,transparent)]"}`}>
        <input
          id={inputId}
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="Email address"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
          aria-invalid={error != null}
          aria-describedby={error ? helpId : undefined}
          className="min-h-11 min-w-0 flex-1 rounded-md border-0 bg-transparent px-3 text-base text-(--color-text) placeholder:text-(--color-text-dim) focus:outline-none!"
        />
        <button
          type="submit"
          disabled={submitting}
          aria-label={submitting ? "Adding to the launch list" : "Notify me"}
          title="Get notified at launch"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-(--color-text) text-(--color-bg) motion-safe:transition-[opacity,box-shadow] motion-safe:duration-300 hover:opacity-85 group-focus-within:shadow-[0_0_16px_color-mix(in_srgb,var(--color-text)_15%,transparent)] disabled:opacity-60"
        >
          {submitting ? <span aria-hidden="true">…</span> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14m-5-5 5 5-5 5" />
          </svg>}
        </button>
      </div>
      {error && <p id={helpId} className="mt-2 text-center text-xs text-(--color-danger)">
        {error}
      </p>}
    </form>
  );
}
