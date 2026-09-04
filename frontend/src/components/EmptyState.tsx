import type { ComponentType, ReactNode } from "react";

/** The "there's nothing here yet" panel, shared by every list.
 *
 *  They had drifted into two different things. Library and the mural
 *  editor drew a dashed panel with a headline, an explanation and a
 *  button; murals, gallery, series, collections and both tournament
 *  lists printed a single dim <p> and nothing else. Same situation, two
 *  visual languages, and the <p> version doesn't read as a state at all
 *  — it reads as a page that failed to load.
 *
 *  An empty state is also the one moment a feature has your full
 *  attention and nothing to compete with, so it's where the app gets to
 *  say what the feature is FOR. Hence: an icon (the same mark the nav
 *  uses for that section, so the panel is visibly about this thing), a
 *  short headline, a sentence of purpose, and the action that ends the
 *  empty state.
 *
 *  `action` is a slot rather than a label+onClick pair because the
 *  callers' buttons genuinely differ — one opens a file picker, one
 *  toggles edit mode, one clears filters — and wrapping that in props
 *  would be a worse fit than passing the button. */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action
}: {
  icon?: ComponentType<{ size?: number }>;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border-2 border-dashed border-(--color-border) px-6 py-12 text-center">
      {Icon && (
        <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-(--color-border) bg-(--color-surface) text-(--color-text-dim)">
          <Icon size={22} />
        </span>
      )}
      <p className="mb-1 font-medium text-(--color-text)">{title}</p>
      {body && <div className="mx-auto max-w-md text-sm text-(--color-text-dim)">{body}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
