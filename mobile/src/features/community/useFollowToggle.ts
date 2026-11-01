import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { followFailureMessage, type PersonResult } from "@scripta/shared/community";
import { followUser, unfollowUser } from "./api";
import { useT } from "../../i18n";

export function useFollowToggle() {
  const t = useT();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(person: PersonResult) {
    setBusyId(person.user.userId);
    setError(null);
    try {
      if (person.viewerFollows) {
        await unfollowUser(person.user.userId);
      } else {
        await followUser(person.user.userId);
      }
      await queryClient.invalidateQueries({ queryKey: ["community", "people"] });
    } catch (reason) {
      setError(followFailureMessage(reason, t("community.followUpdateFailed")));
    } finally {
      setBusyId(null);
    }
  }

  return { busyId, error, toggle };
}
