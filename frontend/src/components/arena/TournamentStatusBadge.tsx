import { tournamentBadge } from "@scripta/shared";
import type { Tournament } from "../../api/arena";
import { StatusBadge } from "../games/GameTicket";
import { useLocale } from "../../i18n";

export function TournamentStatusBadge({ status, currentRound }: { status: Tournament["status"]; currentRound?: number | null }) {
  const locale = useLocale();
  return <StatusBadge {...tournamentBadge({ status, currentRound }, locale)} />;
}
