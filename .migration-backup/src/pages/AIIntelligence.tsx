import { useEffect, useRef, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageMeta } from '@/components/seo/PageMeta';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Brain, Send, Loader2, Sparkles, RotateCcw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { NoBundleBanner } from '@/components/NoBundleBanner';

type Msg = { role: 'user' | 'assistant'; content: string };

const WELCOME: Msg = {
  role: 'assistant',
  content: `**Hi there! 👋 I'm Boostly AI** — your personal SMM strategist.

Ask me anything, just like you would ChatGPT:

- 📈 **"How can I make my Instagram reel go viral?"**
- 🎯 **"What's the best engagement ratio for this link?"** — just paste the link
- ⏰ **"What's the best time to post in India?"**
- 🧩 **"How should I build a bundle and what ratio should I use?"**
- 🛡️ **"How can I reduce detection risk?"**
- 💡 **"Give me content ideas on trending topics"**

**How to use the panel:**
1. **My Providers** → add your SMM provider (API key)
2. **Import Services** → import the provider's services
3. **My Bundles** → build your bundle with the types you want
4. **Full Engagement** or **Mass Order** → place the order
5. **Engagement Orders** → track it live

Let's get started — what would you like to ask? 🚀`,
};

const STORAGE_KEY = 'boostly.ai.chat.v1';

export default function AIIntelligence() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Msg[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      }
    } catch {}
    return [WELCOME];
  });
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data: bundles = [], isLoading: bundlesLoading } = useQuery({
    queryKey: ['ai-intel-bundles', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from('user_bundles')
        .select('id, user_bundle_items(id)')
        .eq('is_active', true);
      return (data || []).filter((b: any) => (b.user_bundle_items?.length || 0) > 0);
    },
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-50))); } catch {}
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next: Msg[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-intelligence', {
        body: { messages: next.map(m => ({ role: m.role, content: m.content })) },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      const reply = (data as any)?.reply || (data as any)?.suggestion || 'No response';
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (e: any) {
      if (e.message?.includes('429')) toast.error('Rate limit — please try again in a moment');
      else if (e.message?.includes('402')) toast.error('AI credits exhausted — please contact admin');
      else toast.error(e.message || 'Failed');
      setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ Error: ${e.message || 'Failed to respond'}` }]);
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function reset() {
    setMessages([WELCOME]);
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const showBundleBanner = !bundlesLoading && bundles.length === 0;

  return (
    <DashboardLayout>
      <PageMeta title="Boostly AI Chat" description="Chat with AI for organic engagement strategy" canonicalPath="/ai-intelligence" noIndex />

      <div className="max-w-4xl mx-auto space-y-4 flex flex-col h-[calc(100vh-8rem)]">
        {showBundleBanner && <NoBundleBanner message="The AI uses the services and pricing from your bundle. Without a bundle, its suggestions won't be accurate." />}

        {/* Header */}
        <div className="glass-card p-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--gradient-luxury)' }}>
              <Brain className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
                Boostly AI <Sparkles className="w-4 h-4 text-primary" />
              </h1>
              <p className="text-xs text-muted-foreground">Your personal SMM strategist — ask me anything</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={reset} className="text-muted-foreground">
            <RotateCcw className="w-4 h-4 mr-1.5" /> New chat
          </Button>
        </div>

        {/* Messages */}
        <div className="glass-card flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                  m.role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-br-md'
                    : 'bg-muted/40 border border-border/40 rounded-bl-md'
                }`}
              >
                {m.role === 'assistant' ? (
                  <div className="prose prose-invert prose-sm max-w-none prose-headings:text-foreground prose-p:text-foreground/90 prose-strong:text-foreground prose-li:text-foreground/90 prose-p:my-2 prose-ul:my-2">
                    <ReactMarkdown>{m.content}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap">{m.content}</div>
                )}
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex justify-start">
              <div className="bg-muted/40 border border-border/40 rounded-2xl rounded-bl-md px-4 py-3 text-sm flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Boostly AI is thinking…
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Composer */}
        <div className="glass-card p-3 shrink-0">
          <div className="flex items-end gap-2">
            <Textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Ask Boostly AI… (Enter to send, Shift+Enter for a new line)"
              className="input-3d flex-1 resize-none min-h-[44px] max-h-40"
              disabled={busy}
            />
            <Button onClick={send} disabled={busy || !input.trim()} className="btn-3d h-11 px-4">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
