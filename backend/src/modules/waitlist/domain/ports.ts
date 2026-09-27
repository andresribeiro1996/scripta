export interface WaitlistEntry {
  email: string;
  createdAt: string;
}

export interface WaitlistRepository {
  insert(email: string, createdAt: string): boolean;
  list(): WaitlistEntry[];
}
