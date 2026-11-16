export const AFTER_FOLLOW = [["community", "people"], ["community", "dashboard"]] as const;

export const AFTER_SHELF_PUBLISH_FAILED = [["community", "own-profile"], ["murals"]] as const;

export function afterShelfPublish(username: string | null) {
  const keys: (readonly string[])[] = [["community", "own-profile"]];
  if (username) keys.push(["community", "profile", username], ["community", "activity", username]);
  return keys;
}
