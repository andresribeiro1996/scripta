export interface WaitlistEntry {
  email: string;
  createdAt: string;
}

export interface WaitlistRepository {
  insert(email: string, createdAt: string): void;
  list(): WaitlistEntry[];
}
