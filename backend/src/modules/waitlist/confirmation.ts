export const confirmationSubject = "You’re on the Atmyshelf launch list";

export function confirmationText(email: string, siteUrl: string): string {
  return [
    "Thanks for joining the Atmyshelf launch list.",
    "",
    `We’ll email ${email} once more, on the day Atmyshelf opens. That’s the only other email this list will send you.`,
    "",
    "Didn’t sign up, or changed your mind? Write to privacy@atmyshelf.com and we’ll remove your address.",
    "",
    `Atmyshelf · ${siteUrl}`
  ].join("\n");
}
