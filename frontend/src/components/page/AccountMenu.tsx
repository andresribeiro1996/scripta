import { useNavigate } from "react-router-dom";
import type { Session } from "../../auth/tokenStore";
import { area, footerAreas } from "../../lib/areas";
import { Avatar } from "../Avatar";
import { OptionsMenu, type OptionsMenuItem } from "../OptionsMenu";
import { ChevronDownIcon } from "../Toolbar";

export function accountMenuItems({ username, isAdmin, navigate, logout }: {
  username: string;
  isAdmin: boolean;
  navigate: (to: string) => void;
  logout: () => void;
}): OptionsMenuItem[] {
  return [
    { label: "My shelf", onClick: () => navigate(`/community/u/${username}`) },
    ...[area("settings"), ...footerAreas(isAdmin)].map((item) => ({ label: item.label, onClick: () => navigate(item.to) })),
    { label: "Log out", onClick: logout, danger: true }
  ];
}

export function AccountMenu({ user, isAdmin, active, onLogout }: {
  user: Session["user"];
  isAdmin: boolean;
  active: boolean;
  onLogout: () => void;
}) {
  const navigate = useNavigate();
  const username = user.username ?? user.email;
  return (
    <OptionsMenu
      title="Account menu"
      heading={`@${username}`}
      items={accountMenuItems({ username, isAdmin, navigate, logout: onLogout })}
      triggerClassName={`inline-flex min-h-11 items-center gap-1.5 rounded-full pl-1 pr-2 text-(--color-text-dim) hover:bg-(--color-surface-hover)${active ? " bg-(--color-surface-hover)" : ""}`}
      trigger={
        <>
          <Avatar user={user} size={32} />
          <ChevronDownIcon />
        </>
      }
    />
  );
}
