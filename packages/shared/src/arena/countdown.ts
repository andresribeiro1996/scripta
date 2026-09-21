// Hours roll into days: a round that closes in a week read as "150h 8m
// left", which is arithmetic the reader has to finish themselves.
export function countdownLabel(closesAt: string, now = Date.now()): string {
  const remainingMs = new Date(closesAt).getTime() - now;
  if (remainingMs <= 0) return "Closing…";
  const totalSeconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h left`;
  return hours > 0 ? `${hours}h ${minutes}m left` : minutes > 0 ? `${minutes}m ${seconds}s left` : `${seconds}s left`;
}
