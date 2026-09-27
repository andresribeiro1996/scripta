export interface WaitlistRepository {
  insert(email: string, createdAt: string): void;
}
