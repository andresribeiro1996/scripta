import AsyncStorage from "@react-native-async-storage/async-storage";
import { randomUUID } from "expo-crypto";
import { useQuery } from "@tanstack/react-query";
import { DAILY_CHAPTER_GUEST_STORAGE, isDailyChapterGuestId } from "@scripta/shared";
import { useAuth } from "../../core/auth";
import { dailyChapterApi } from "./api";

export async function deviceIdentity() {
  const stored = await AsyncStorage.getItem(DAILY_CHAPTER_GUEST_STORAGE);
  if (isDailyChapterGuestId(stored)) return stored;
  const id = randomUUID();
  await AsyncStorage.setItem(DAILY_CHAPTER_GUEST_STORAGE, id);
  return id;
}

export function useDeviceIdentity() {
  return useQuery({ queryKey: ["daily-chapter", "identity"], queryFn: deviceIdentity, staleTime: Infinity });
}

export function useDailyHistory() {
  const { user } = useAuth();
  const guestId = useDeviceIdentity().data;
  return useQuery({ queryKey: ["daily-chapter", "history", user?.id, guestId], queryFn: () => dailyChapterApi.history(guestId!, true), enabled: Boolean(user && guestId) });
}
