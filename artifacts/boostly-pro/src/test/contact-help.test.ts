import { describe, expect, it } from "vitest";
import { contactLink } from "../lib/contact-help";
describe("public help contacts", () => {
  it("uses the WhatsApp number supplied in the request", () => {
    expect(new URL(contactLink("whatsapp", "subscription")).pathname).toBe("/13678288027");
  });
  it("uses the requested Telegram username", () => {
    expect(new URL(contactLink("telegram", "support")).pathname).toBe("/Henrymiller08");
  });
});
