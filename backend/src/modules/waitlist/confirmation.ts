import { renderEmail } from "../auth/index.js";

export const confirmationSubject = "You’re on the Atmyshelf launch list";

export function confirmationEmail(email: string, siteUrl: string): { text: string; html: string } {
  return renderEmail({
    heading: "You’re on the list",
    paragraphs: [
      "Thanks for joining the Atmyshelf launch list.",
      `We’ll email ${email} once more, on the day Atmyshelf opens. That’s the only other email this list will send you.`
    ],
    footnote: "Didn’t sign up, or changed your mind? Write to privacy@atmyshelf.com and we’ll remove your address."
  }, siteUrl);
}
