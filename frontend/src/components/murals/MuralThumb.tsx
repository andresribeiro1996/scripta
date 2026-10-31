import { themes, type ThemeId } from "@scripta/shared/themes";
import type { BlockLayout } from "../../lib/murals";
import { MuralsIcon } from "../NavIcons";

export function MuralThumb({ theme, coverUrl, layouts = [], className = "" }: { theme: ThemeId; coverUrl?: string | null; layouts?: BlockLayout[]; className?: string }) {
  const colors = themes[theme].colors;
  const bottom = Math.max(1, ...layouts.map((layout) => layout.y + layout.h));
  return (
    <div aria-hidden="true" className={`relative overflow-hidden ${className}`} style={{ background: colors.background, color: colors.accent }}>
      {coverUrl ? (
        <img src={coverUrl} alt="" className="absolute inset-0 size-full object-cover" />
      ) : layouts.length > 0 ? (
        layouts.map((layout, index) => (
          <span
            key={index}
            className="absolute rounded-sm border"
            style={{ left: `${(layout.x / 12) * 100}%`, top: `${(layout.y / bottom) * 100}%`, width: `calc(${(layout.w / 12) * 100}% - 3px)`, height: `calc(${(layout.h / bottom) * 100}% - 3px)`, background: colors.surface, borderColor: colors.border }}
          />
        ))
      ) : (
        <span className="absolute inset-0 flex items-center justify-center"><MuralsIcon size={36} /></span>
      )}
    </div>
  );
}
