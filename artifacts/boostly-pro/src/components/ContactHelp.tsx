import { useState } from "react";
import { FaWhatsapp, FaTelegramPlane } from "react-icons/fa";
import { ArrowUpRight, CreditCard, LifeBuoy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { contactLink, contactMessages, type ContactIntent } from "@/lib/contact-help";

export function ContactHelp() {
  const [intent, setIntent] = useState<ContactIntent>("subscription");
  const [openChannel, setOpenChannel] = useState<string | null>(null);
  return (
    <aside className="contact-help" aria-label="Subscription and support contacts">
      <span className="contact-help-label">Need help?</span>
      <div className="contact-help-actions">
        {(["whatsapp", "telegram"] as const).map(channel => {
          const whatsapp = channel === "whatsapp";
          const name = whatsapp ? "WhatsApp" : "Telegram";
          const Icon = whatsapp ? FaWhatsapp : FaTelegramPlane;
          return (
            <Popover key={channel} open={openChannel === channel} onOpenChange={open => setOpenChannel(open ? channel : null)}>
              <PopoverTrigger asChild>
                <Button size="icon" variant={whatsapp ? "success" : "default"} className="contact-help-icon" aria-label={`${name} subscription and support`} title={`${name} — subscription & support`}><Icon /></Button>
              </PopoverTrigger>
              <PopoverContent side="top" align="end" sideOffset={12} collisionPadding={16} className="contact-help-panel">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 font-semibold"><Icon className="text-primary" />{name}</div>
                  <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Close contact menu" onClick={() => setOpenChannel(null)}><X /></Button>
                </div>
                <h2 className="mt-3 text-lg font-semibold tracking-normal">Let's get you sorted.</h2>
                <p className="mt-1 text-sm text-muted-foreground">Subscriptions & account support</p>
                <div className="mt-4 grid grid-cols-2 gap-2" aria-label="Message topic">
                  <Button size="sm" variant={intent === "subscription" ? "default" : "outline"} aria-pressed={intent === "subscription"} onClick={() => setIntent("subscription")}><CreditCard />Subscription</Button>
                  <Button size="sm" variant={intent === "support" ? "default" : "outline"} aria-pressed={intent === "support"} onClick={() => setIntent("support")}><LifeBuoy />Get help</Button>
                </div>
                <p className="my-4 border-l-2 border-primary pl-3 text-sm leading-relaxed">{contactMessages[intent]}</p>
                <Button asChild variant={whatsapp ? "success" : "default"} className="w-full"><a href={contactLink(channel, intent)} target="_blank" rel="noopener noreferrer">Message on {name}<ArrowUpRight /></a></Button>
                <p className="mt-3 text-center text-xs text-muted-foreground">{whatsapp ? "+1 (367) 828-8027" : "@Henrymiller08"}</p>
              </PopoverContent>
            </Popover>
          );
        })}
      </div>
    </aside>
  );
}
