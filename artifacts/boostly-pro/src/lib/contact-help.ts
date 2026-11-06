export type ContactIntent = "subscription" | "support";
export const contactMessages: Record<ContactIntent, string> = {
  subscription: "Hi! I'd like to subscribe to Boostly Pro. Please help me choose a plan and activate my subscription.",
  support: "Hi! I need help with Boostly Pro. I'm having an issue with my account. Could you please assist me?",
};
export function contactLink(channel: "whatsapp" | "telegram", intent: ContactIntent) {
  const text = encodeURIComponent(contactMessages[intent]);
  return channel === "whatsapp" ? `https://wa.me/13678288027?text=${text}` : `https://t.me/Henrymiller08?text=${text}`;
}
