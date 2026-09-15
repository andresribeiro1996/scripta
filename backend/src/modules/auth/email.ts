import { env } from "../../config/env.js";

export const emailEnabled = Boolean(env.RESEND_API_KEY && env.AUTH_EMAIL_FROM && new URL(env.FRONTEND_URL).protocol === "https:");

export async function sendAccountEmail(to: string, subject: string, text: string): Promise<void> {
  if (!emailEnabled) throw new Error("Email delivery is not configured.");
  if (new URL(env.FRONTEND_URL).protocol !== "https:") throw new Error("Account emails require an HTTPS FRONTEND_URL.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.AUTH_EMAIL_FROM, to: [to], subject, text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Account email delivery failed (${response.status}).`);
}
