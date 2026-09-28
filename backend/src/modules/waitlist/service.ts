import type { WaitlistEntry, WaitlistRepository } from "./domain/ports.js";

export interface WaitlistService {
  join(email: string): void;
  list(): WaitlistEntry[];
}

export function createWaitlistService(repo: WaitlistRepository, onJoined?: (email: string) => void): WaitlistService {
  return {
    join(email) {
      const normalizedEmail = email.trim().toLowerCase();
      if (repo.insert(normalizedEmail, new Date().toISOString())) onJoined?.(normalizedEmail);
    },
    list() {
      return repo.list();
    }
  };
}
