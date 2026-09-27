import type { WaitlistRepository } from "./domain/ports.js";

export interface WaitlistService {
  join(email: string): void;
}

export function createWaitlistService(repo: WaitlistRepository): WaitlistService {
  return {
    join(email) {
      const normalizedEmail = email.trim().toLowerCase();
      repo.insert(normalizedEmail, new Date().toISOString());
    }
  };
}
