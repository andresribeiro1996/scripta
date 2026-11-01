import type { Locale } from "@scripta/shared/i18n";
import type { WaitlistEntry, WaitlistRepository } from "./domain/ports.js";

export interface WaitlistService {
  join(email: string, locale: Locale): void;
  list(): WaitlistEntry[];
}

export function createWaitlistService(repo: WaitlistRepository, onJoined?: (email: string, locale: Locale) => void): WaitlistService {
  return {
    join(email, locale) {
      const normalizedEmail = email.trim().toLowerCase();
      if (repo.insert(normalizedEmail, new Date().toISOString())) onJoined?.(normalizedEmail, locale);
    },
    list() {
      return repo.list();
    }
  };
}
