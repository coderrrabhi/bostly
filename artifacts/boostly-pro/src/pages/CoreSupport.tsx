import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { PageMeta } from "@/components/seo/PageMeta";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  AlertCircle,
  Bug,
  CheckCircle,
  ChevronDown,
  Clock,
  CreditCard,
  Crown,
  HelpCircle,
  LifeBuoy,
  Loader2,
  MessageSquare,
  Plus,
  Send,
  Settings,
  ShoppingCart,
} from "lucide-react";
import { format } from "date-fns";

const CATEGORIES = [
  { value: "order", label: "Order Issue", icon: ShoppingCart },
  { value: "payment", label: "Payment/Wallet", icon: CreditCard },
  { value: "subscription", label: "Subscription", icon: Crown },
  { value: "technical", label: "Technical Problem", icon: Bug },
  { value: "account", label: "Account Settings", icon: Settings },
  { value: "other", label: "Other", icon: HelpCircle },
];

const PRIORITIES = [
  { value: "low", label: "Low", color: "bg-blue-500" },
  { value: "medium", label: "Medium", color: "bg-yellow-500" },
  { value: "high", label: "High", color: "bg-orange-500" },
  { value: "urgent", label: "Urgent", color: "bg-red-500" },
];

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof MessageSquare }> = {
  open: { label: "Open", color: "bg-blue-500", icon: MessageSquare },
  pending: { label: "Pending", color: "bg-yellow-500", icon: Clock },
  in_progress: { label: "In Progress", color: "bg-orange-500", icon: Clock },
  resolved: { label: "Resolved", color: "bg-green-500", icon: CheckCircle },
  closed: { label: "Closed", color: "bg-muted", icon: CheckCircle },
};

const FAQ_ITEMS = [
  { question: "How long does delivery take?", answer: "Delivery typically starts within 0-1 hour of order placement. Organic mode orders are spread over 24-72 hours for natural growth patterns. You can track progress in real-time from your Orders page." },
  { question: "What payment methods do you accept?", answer: "We accept INR payments via UPI, Net Banking, Cards and Wallets through Razorpay. All amounts on the platform are shown in Indian Rupees (₹)." },
  { question: "Can I get a refund?", answer: "Yes! If your order is not delivered or only partially delivered, you're eligible for a refund. Contact support with your order number and we'll process it within 24-48 hours." },
  { question: "What is Organic Mode?", answer: "Organic Mode spreads your engagement over time with natural variance, mimicking real user behavior. This helps avoid detection and provides more sustainable growth for your content." },
  { question: "How do I check my order status?", answer: "Go to the Orders or Engagement Orders page from the sidebar. You'll see real-time status updates, progress tracking, and detailed timeline for each order." },
  { question: "What happens if my order fails?", answer: "If an order fails, your wallet is automatically refunded. You can view the error details on the order page and create a support ticket if you need further assistance." },
];

type Ticket = {
  id: string;
  subject: string;
  message: string;
  category: string;
  priority: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export default function CoreSupport() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [showFAQ, setShowFAQ] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState("other");
  const [priority, setPriority] = useState("medium");

  const { data: tickets = [], isLoading } = useQuery<Ticket[]>({
    queryKey: ["support-tickets", user?.id],
    queryFn: api.getSupportTickets,
    enabled: !!user,
  });

  const resetForm = () => {
    setSubject("");
    setMessage("");
    setCategory("other");
    setPriority("medium");
  };

  const createTicketMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not authenticated");
      if (!subject.trim()) throw new Error("Please enter a subject");
      if (!message.trim()) throw new Error("Please describe your issue");

      return api.createSupportTicket({
        subject: subject.trim(),
        message: message.trim(),
        category,
        priority,
      });
    },
    onSuccess: () => {
      toast.success("Ticket Created!", { description: "Our support team will respond soon." });
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
      setIsDialogOpen(false);
      resetForm();
    },
    onError: (error: Error) => {
      toast.error("Error", { description: error.message });
    },
  });

  const openTickets = tickets.filter((ticket) => ticket.status !== "closed" && ticket.status !== "resolved");
  const closedTickets = tickets.filter((ticket) => ticket.status === "closed" || ticket.status === "resolved");

  return (
    <DashboardLayout>
      <PageMeta
        title="Support & FAQ — Boostly Pro"
        description="Boostly Pro support: open tickets, browse FAQs about delivery times, payments, refunds and Organic Mode. We respond within 24 hours."
        canonicalPath="/support"
        breadcrumbs={[{ name: "Home", path: "/" }, { name: "Support", path: "/support" }]}
        faqItems={FAQ_ITEMS.map((item) => ({ question: item.question, answer: item.answer }))}
      />
      <div className="space-y-6">
        <div className="relative overflow-hidden rounded-2xl glass-card p-6 sm:p-8">
          <div className="relative z-10">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 p-3">
                  <LifeBuoy className="h-6 w-6 text-primary sm:h-8 sm:w-8" />
                </div>
                <div><h1 className="text-2xl font-bold sm:text-3xl">Support Center</h1><p className="text-sm text-muted-foreground">Get help with your orders and account</p></div>
              </div>
              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild><Button className="w-full gap-2 sm:w-auto"><Plus className="h-4 w-4" />New Ticket</Button></DialogTrigger>
                <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
                  <DialogHeader><DialogTitle>Create Support Ticket</DialogTitle><DialogDescription>Describe your issue and we'll get back to you as soon as possible.</DialogDescription></DialogHeader>
                  <div className="mt-4 space-y-4">
                    <div className="space-y-2"><Label>Category</Label><Select value={category} onValueChange={setCategory}><SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger><SelectContent>{CATEGORIES.map((item) => <SelectItem key={item.value} value={item.value}><div className="flex items-center gap-2"><item.icon className="h-4 w-4" />{item.label}</div></SelectItem>)}</SelectContent></Select></div>
                    <div className="space-y-2"><Label>Priority</Label><Select value={priority} onValueChange={setPriority}><SelectTrigger><SelectValue placeholder="Select priority" /></SelectTrigger><SelectContent>{PRIORITIES.map((item) => <SelectItem key={item.value} value={item.value}><div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${item.color}`} />{item.label}</div></SelectItem>)}</SelectContent></Select></div>
                    <div className="space-y-2"><Label>Subject</Label><Input placeholder="Brief description of your issue" value={subject} onChange={(event) => setSubject(event.target.value)} /></div>
                    <div className="space-y-2"><Label>Message</Label><Textarea placeholder="Please provide as much detail as possible..." value={message} onChange={(event) => setMessage(event.target.value)} rows={5} /></div>
                    <Button className="w-full gap-2" onClick={() => createTicketMutation.mutate()} disabled={createTicketMutation.isPending}>{createTicketMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Submit Ticket</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
          <div className="absolute right-0 top-0 h-40 w-40 rounded-full bg-gradient-to-bl from-primary/10 to-transparent blur-3xl" />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          <Card className="glass-card"><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-primary sm:text-3xl">{tickets.length}</p><p className="text-xs text-muted-foreground sm:text-sm">Total Tickets</p></CardContent></Card>
          <Card className="glass-card"><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-blue-500 sm:text-3xl">{openTickets.length}</p><p className="text-xs text-muted-foreground sm:text-sm">Open</p></CardContent></Card>
          <Card className="glass-card"><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-green-500 sm:text-3xl">{closedTickets.length}</p><p className="text-xs text-muted-foreground sm:text-sm">Resolved</p></CardContent></Card>
          <Card className="glass-card"><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-yellow-500 sm:text-3xl">~2h</p><p className="text-xs text-muted-foreground sm:text-sm">Avg Response</p></CardContent></Card>
        </div>

        <h2 className="sr-only">Your Support Tickets</h2>
        <Card className="glass-card">
          <CardHeader><CardTitle className="flex items-center gap-2"><MessageSquare className="h-5 w-5 text-primary" />Your Tickets</CardTitle><CardDescription>View and track your support requests</CardDescription></CardHeader>
          <CardContent>
            {isLoading ? <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div> : tickets.length > 0 ? <div className="space-y-3">
              {tickets.map((ticket) => {
                const status = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.open;
                const StatusIcon = status.icon;
                const categoryItem = CATEGORIES.find((item) => item.value === ticket.category);
                const CategoryIcon = categoryItem?.icon || HelpCircle;
                const priorityItem = PRIORITIES.find((item) => item.value === ticket.priority);
                return <div key={ticket.id} className="cursor-pointer rounded-xl border border-border bg-card/50 p-4 transition-colors hover:bg-card/80" onClick={() => setSelectedTicket(ticket)}>
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div className="flex min-w-0 flex-1 items-start gap-3"><div className="shrink-0 rounded-lg bg-primary/10 p-2"><CategoryIcon className="h-4 w-4 text-primary" /></div><div className="min-w-0 flex-1"><h3 className="truncate font-semibold">{ticket.subject}</h3><p className="line-clamp-1 text-sm text-muted-foreground">{ticket.message}</p><div className="mt-2 flex flex-wrap items-center gap-2"><Badge variant="secondary" className={`${status.color} text-xs text-white`}><StatusIcon className="mr-1 h-3 w-3" />{status.label}</Badge>{priorityItem && <Badge variant="outline" className="gap-1 text-xs"><span className={`h-1.5 w-1.5 rounded-full ${priorityItem.color}`} />{priorityItem.label}</Badge>}</div></div></div><div className="shrink-0 text-xs text-muted-foreground">{format(new Date(ticket.createdAt), "MMM d, h:mm a")}</div></div>
                </div>;
              })}
            </div> : <div className="py-12 text-center"><div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10"><LifeBuoy className="h-8 w-8 text-primary" /></div><h3 className="mb-2 font-semibold">No tickets yet</h3><p className="mb-4 text-sm text-muted-foreground">Need help? Create a support ticket and we'll assist you.</p><Button onClick={() => setIsDialogOpen(true)} className="gap-2"><Plus className="h-4 w-4" />Create Your First Ticket</Button></div>}
          </CardContent>
        </Card>

        <Dialog open={!!selectedTicket} onOpenChange={() => setSelectedTicket(null)}>
          <DialogContent className="max-w-lg"><DialogHeader><DialogTitle className="flex items-center gap-2"><MessageSquare className="h-5 w-5 text-primary" />Ticket Details</DialogTitle></DialogHeader>
            {selectedTicket && <div className="space-y-4"><div><Label className="text-xs text-muted-foreground">Subject</Label><p className="font-semibold">{selectedTicket.subject}</p></div><div className="flex gap-4"><div><Label className="text-xs text-muted-foreground">Status</Label><Badge className={`${STATUS_CONFIG[selectedTicket.status]?.color || "bg-muted"} mt-1 text-white`}>{STATUS_CONFIG[selectedTicket.status]?.label || selectedTicket.status}</Badge></div><div><Label className="text-xs text-muted-foreground">Priority</Label><Badge variant="outline" className="mt-1 gap-1"><span className={`h-1.5 w-1.5 rounded-full ${PRIORITIES.find((item) => item.value === selectedTicket.priority)?.color || "bg-muted"}`} />{PRIORITIES.find((item) => item.value === selectedTicket.priority)?.label || selectedTicket.priority}</Badge></div><div><Label className="text-xs text-muted-foreground">Category</Label><p className="mt-1 text-sm capitalize">{selectedTicket.category}</p></div></div><div><Label className="text-xs text-muted-foreground">Message</Label><div className="mt-1 whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm">{selectedTicket.message}</div></div><div className="flex justify-between border-t pt-4 text-xs text-muted-foreground"><span>Created: {format(new Date(selectedTicket.createdAt), "MMM d, yyyy h:mm a")}</span>{selectedTicket.updatedAt !== selectedTicket.createdAt && <span>Updated: {format(new Date(selectedTicket.updatedAt), "MMM d, h:mm a")}</span>}</div><div className="rounded-lg border border-primary/20 bg-primary/5 p-4"><p className="text-sm text-muted-foreground"><strong className="text-foreground">💬 Support Response:</strong> Our team will respond to your ticket via email. Please check your inbox for updates.</p></div></div>}
          </DialogContent>
        </Dialog>

        <h2 className="sr-only">Quick Help</h2>
        <Card className="glass-card border-primary/20"><CardContent className="p-6"><div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left"><div className="rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 p-4"><HelpCircle className="h-8 w-8 text-primary" /></div><div className="flex-1"><h3 className="text-lg font-bold">Need Quick Help?</h3><p className="text-sm text-muted-foreground">Check our FAQ or contact us directly for urgent issues</p></div><div className="flex flex-wrap justify-center gap-2"><Button variant="outline" className="gap-2" onClick={() => setShowFAQ(!showFAQ)}><HelpCircle className="h-4 w-4" />View FAQ<ChevronDown className={`h-4 w-4 transition-transform ${showFAQ ? "rotate-180" : ""}`} /></Button><Button variant="outline" className="gap-2" onClick={() => { const chatButton = document.querySelector("[data-live-chat-trigger]") as HTMLButtonElement; if (chatButton) chatButton.click(); }}><MessageSquare className="h-4 w-4" />Live Chat</Button></div></div>
          {showFAQ && <div className="mt-6 border-t border-border pt-6"><Accordion type="single" collapsible className="w-full">{FAQ_ITEMS.map((item, index) => <AccordionItem key={index} value={`faq-${index}`}><AccordionTrigger className="text-left hover:no-underline">{item.question}</AccordionTrigger><AccordionContent className="text-muted-foreground">{item.answer}</AccordionContent></AccordionItem>)}</Accordion></div>}
        </CardContent></Card>
      </div>
    </DashboardLayout>
  );
}