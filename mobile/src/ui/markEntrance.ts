let played = false;

export function entranceAvailable(): boolean {
  return !played;
}

export function markEntrancePlayed(): void {
  played = true;
}
