const STARS = [0, 1, 2, 3, 4];
const SIZE = 12;

function Stars({ className = "" }: { className?: string }) {
  return (
    <span className={`flex ${className}`}>
      {STARS.map((star) => (
        <svg key={star} width={SIZE} height={SIZE} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
          <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" />
        </svg>
      ))}
    </span>
  );
}

export function RatingStars({ value, label }: { value: number; label: string }) {
  return (
    <p className="flex items-center gap-2">
      <span role="img" aria-label={`Rated ${value.toFixed(1)} out of 5`} className="relative flex w-fit">
        <Stars className="opacity-40" />
        <span className="absolute inset-y-0 left-0 overflow-hidden text-(--color-accent)" style={{ width: `${Math.min(100, (value / 5) * 100)}%` }}>
          <Stars />
        </span>
      </span>
      {label}
    </p>
  );
}
