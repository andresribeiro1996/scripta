import { publicFetch } from "./client";

export async function joinWaitlist(email: string): Promise<void> {
  await publicFetch("/waitlist", { method: "POST", body: JSON.stringify({ email }) });
}
