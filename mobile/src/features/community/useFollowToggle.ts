import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { followFailureMessage, type PersonResult } from "@scripta/shared/community";
import { followUser, unfollowUser } from "./api";

export function useFollowToggle() {
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
      setError(followFailureMessage(reason, "Couldn't update who you follow."));
    } finally {
      setBusyId(null);
    }
  }

  return { busyId, error, toggle };
}
