import { useId, useState } from "react";
import { ApiError } from "../../api/client";
import { joinWaitlist } from "../../api/waitlist";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_HELP = "We’ll only email you about the launch.";

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
        className="flex w-full max-w-[520px] items-start gap-2.5 rounded-lg border border-(--color-border) bg-(--color-surface) px-4 py-3.5 text-left text-sm leading-relaxed"
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
      <label htmlFor={inputId} className="block text-sm font-semibold">
        {label}
      </label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          id={inputId}
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
          aria-invalid={error != null}
          aria-describedby={helpId}
          className={`min-h-12 flex-grow rounded-lg border bg-(--color-surface) px-3.5 text-base text-(--color-text) transition-[border-color,box-shadow] duration-150 placeholder:text-(--color-text-dim) focus:border-(--color-accent) focus:ring-1 focus:ring-(--color-accent) focus:outline-none ${
            error ? "border-(--color-danger)" : "border-(--color-border)"
          }`}
        />
        <button
          type="submit"
          disabled={submitting}
          className="flex min-h-12 shrink-0 items-center justify-center rounded-lg bg-(--color-accent) px-6 text-base font-semibold text-(--color-on-accent) transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {submitting ? "Adding…" : "Notify me"}
        </button>
      </div>
      <p id={helpId} className={`mt-2 text-xs ${error ? "text-(--color-danger)" : "text-(--color-text-dim)"}`}>
        {error ?? DEFAULT_HELP}
      </p>
    </form>
  );
}
