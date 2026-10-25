import type { ComponentType } from "react";
import { Link } from "react-router-dom";
import type { Area, AreaId } from "../../lib/areas";
import { ArenaIcon, CommunityIcon, HomeIcon, InfoIcon, LibraryIcon, MuralsIcon, ReaderCardIcon, SettingsIcon } from "../NavIcons";

export const AREA_ICONS: Record<AreaId, ComponentType<{ size?: number }>> = {
  home: HomeIcon,
  library: LibraryIcon,
  murals: MuralsIcon,
  games: ArenaIcon,
  readerCard: ReaderCardIcon,
  community: CommunityIcon,
  settings: SettingsIcon,
  admin: InfoIcon
};

export function SidebarNav({ areas, activeId, homeBadge, onNavigate, withDescriptions }: {
  areas: readonly Area[];
  activeId: AreaId | null;
  homeBadge?: string | null;
  onNavigate?: () => void;
  withDescriptions?: boolean;
}) {
  return (
    <>
      {areas.map((item) => {
        const Icon = AREA_ICONS[item.id];
        const active = item.id === activeId;
        const badge = item.id === "home" ? homeBadge : null;
        return (
          <Link
            key={item.id}
            to={item.to}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            aria-label={badge ? `${item.label}, ${badge} new` : undefined}
            className={`flex min-h-11 items-start gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
              active
                ? "bg-(--color-accent-soft) text-(--color-accent)"
                : "text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)"
            }`}
          >
            <span className="mt-px shrink-0">
              <Icon size={18} />
            </span>
            <span>
              {item.label}
              {withDescriptions && item.description && (
                <span className="block text-xs font-normal text-(--color-text-dim)">{item.description}</span>
              )}
            </span>
            {badge && (
              <span className="ml-auto self-center rounded-full bg-(--color-accent) px-1.5 text-[10px] font-bold text-(--color-on-accent)">{badge}</span>
            )}
          </Link>
        );
      })}
    </>
  );
}
