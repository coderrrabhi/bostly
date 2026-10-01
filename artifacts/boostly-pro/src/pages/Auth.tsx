import { API_BASE, apiUrl } from "@/lib/apiBase";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { ArrowLeft, ArrowRight, Eye, EyeOff, Loader2, Mail } from "lucide-react";
import { z } from "zod";
import logo from "@/assets/logo.png";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageMeta } from "@/components/seo/PageMeta";
import { supabase } from "@/integrations/supabase/client";

const loginSchema = z.object({
  email: z.string().trim().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const signupSchema = loginSchema.extend({
  fullName: z.string().trim().min(2, "Name must be at least 2 characters"),
});

type AuthMode = "login" | "signup" | "verify" | "forgot" | "reset";

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  const clerkError = error as { longMessage?: string; message?: string; errors?: Array<{ longMessage?: string; message?: string }> };
  return clerkError.longMessage || clerkError.message || clerkError.errors?.[0]?.longMessage || clerkError.errors?.[0]?.message || "Something went wrong. Please try again.";
}

export default function Auth() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isLoading } = useAuth();
  const userLoaded = !isLoading;
  const isSignedIn = !!user;
  const post = async (path: string, body: unknown) => {
    const r = await fetch(apiUrl(path), { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
    const b = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok) throw new Error(b.error || "Something went wrong. Please try again.");
    window.dispatchEvent(new Event("boostly:auth-changed"));
  };
  const [mode, setMode] = useState<AuthMode>(location.pathname.includes("/sign-up") ? "signup" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [code, setCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (userLoaded && isSignedIn) navigate("/engagement-order", { replace: true });
  }, [isSignedIn, userLoaded, navigate]);

  const clearMessages = () => {
    setError("");
    setSuccessMessage("");
  };

  const switchMode = (next: AuthMode) => {
    clearMessages();
    setCode("");
    setMode(next);
    if (next === "login") navigate("/sign-in", { replace: true });
    if (next === "signup") navigate("/sign-up", { replace: true });
  };

  const handleAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    clearMessages();
    setIsSubmitting(true);
    try {
      if (mode === "login") {
        const credentials = loginSchema.parse({ email, password });
        const cloudResult = await supabase.auth.signInWithPassword({ email: credentials.email.toLowerCase(), password: credentials.password });
        if (cloudResult.error) throw cloudResult.error;
      } else {
        const credentials = signupSchema.parse({ email, password, fullName });
        const cloudResult = await supabase.auth.signUp({
          email: credentials.email.toLowerCase(),
          password: credentials.password,
          options: { emailRedirectTo: window.location.origin, data: { full_name: credentials.fullName } },
        });
        if (cloudResult.error) throw cloudResult.error;
      }
      navigate("/engagement-order", { replace: true });
    } catch (cause) {
      if (cause instanceof z.ZodError) setError(cause.issues[0]?.message || "Please check your details.");
      else setError(errorMessage(cause));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerify = async (event: React.FormEvent) => {
    event.preventDefault();
    clearMessages();
    setIsSubmitting(true);
    try {
      navigate("/engagement-order", { replace: true });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgot = async (event: React.FormEvent) => {
    event.preventDefault();
    clearMessages();
    setIsSubmitting(true);
    try {
      z.string().trim().email("Enter a valid email address").parse(email);
      throw new Error("Password reset ke liye Telegram support se contact karein.");
    } catch (cause) {
      setError(cause instanceof z.ZodError ? cause.issues[0].message : errorMessage(cause));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = async (event: React.FormEvent) => {
    event.preventDefault();
    clearMessages();
    setIsSubmitting(true);
    try {
      throw new Error("Password reset ke liye Telegram support se contact karein.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClass =
    "h-12 rounded-xl border-[#dbe4f5] bg-white px-4 font-medium text-[#0B1220] placeholder:text-[#8892AB] transition-all focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20";
  const isLogin = mode === "login";
  const title = mode === "verify" ? "Check your inbox" : mode === "forgot" || mode === "reset" ? "Reset password" : isLogin ? "Welcome back" : "Create account";
  const subtitle =
    mode === "verify"
      ? `Verification code sent to ${email}`
      : mode === "forgot"
        ? "Enter your email to receive a reset code."
        : mode === "reset"
          ? "Enter the code and choose a new password."
          : isLogin
            ? "Sign in to your account."
            : "Get started for free.";

  return (
    <main className="min-h-screen px-6 py-12" style={{ background: "linear-gradient(180deg, #EAF1FF 0%, #F4F7FF 60%, #DCE7FF 100%)" }}>
      <PageMeta title={`${title} — Boostly Pro`} description="Sign in or create your secure Boostly Pro customer portal account." canonicalPath={isLogin ? "/sign-in" : "/sign-up"} />
      <div className="mx-auto w-full max-w-[400px]">
        <div className="mb-10 flex items-center justify-center gap-2.5">
          <img src={logo} alt="Boostly Pro" className="h-10 w-10 rounded-xl object-cover shadow-sm" />
          <div className="flex flex-col">
            <span className="text-[16px] font-bold tracking-tight text-[#111827]">Boostly Pro</span>
            <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-[#111827]">✦ Updated Version</span>
          </div>
        </div>

        <Link to="/" className="mb-8 inline-flex items-center gap-1.5 text-[12px] font-medium text-[#999]">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to home
        </Link>

        <h1 className="mb-1 text-2xl font-extrabold tracking-tight text-[#111827]" style={{ fontFamily: "'Outfit', system-ui, sans-serif" }}>{title}</h1>
        <p className="mb-8 text-[14px] text-[#888]">{subtitle}</p>

        {mode === "verify" ? (
          <form onSubmit={handleVerify} className="space-y-4">
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#EAF1FF]"><Mail className="h-6 w-6 text-[#2563EB]" /></div>
            <Field label="Verification code"><Input inputMode="numeric" autoComplete="one-time-code" placeholder="Enter 6-digit code" value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} /></Field>
            <Messages error={error} success={successMessage} />
            <SubmitButton loading={isSubmitting}>Verify email</SubmitButton>
            <BackButton onClick={() => switchMode("signup")} />
          </form>
        ) : mode === "forgot" ? (
          <form onSubmit={handleForgot} className="space-y-4">
            <Field label="Email"><Input type="email" autoComplete="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} /></Field>
            <Messages error={error} success={successMessage} />
            <SubmitButton loading={isSubmitting}>Send reset code</SubmitButton>
            <BackButton onClick={() => switchMode("login")} />
          </form>
        ) : mode === "reset" ? (
          <form onSubmit={handleReset} className="space-y-4">
            <Field label="Reset code"><Input inputMode="numeric" autoComplete="one-time-code" placeholder="Enter code" value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} /></Field>
            <PasswordField value={password} setValue={setPassword} show={showPassword} setShow={setShowPassword} inputClass={inputClass} label="New password" />
            <Messages error={error} success={successMessage} />
            <SubmitButton loading={isSubmitting}>Update password</SubmitButton>
            <BackButton onClick={() => switchMode("login")} />
          </form>
        ) : (
          <form onSubmit={handleAuth} className="space-y-4">
            {!isLogin && <Field label="Full name"><Input autoComplete="name" placeholder="John Doe" value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} /></Field>}
            <Field label="Email"><Input type="email" autoComplete="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} /></Field>
            <PasswordField value={password} setValue={setPassword} show={showPassword} setShow={setShowPassword} inputClass={inputClass} onForgot={isLogin ? () => switchMode("forgot") : undefined} />
            {/* Mount point for Clerk's bot-protection widget on custom sign-up
                flows; without it Clerk falls back to an invisible challenge
                that fails to load in some browsers. */}
            <Messages error={error} success={successMessage} />
            <SubmitButton loading={isSubmitting}>{isLogin ? "Sign in" : "Create account"}</SubmitButton>
            <p className="text-center text-[13px] text-[#999]">
              {isLogin ? "Don't have an account? " : "Already have an account? "}
              <button type="button" onClick={() => switchMode(isLogin ? "signup" : "login")} className="font-semibold text-[#111827]">{isLogin ? "Sign up" : "Sign in"}</button>
            </p>
          </form>
        )}

        <TelegramCard />
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label className="mb-1.5 block text-[12px] font-semibold normal-case tracking-normal text-[#555]">{label}</Label>{children}</div>;
}

function PasswordField({ value, setValue, show, setShow, inputClass, label = "Password", onForgot }: { value: string; setValue: (value: string) => void; show: boolean; setShow: (value: boolean) => void; inputClass: string; label?: string; onForgot?: () => void }) {
  return <div>
    <div className="mb-1.5 flex items-center justify-between"><Label className="text-[12px] font-semibold normal-case tracking-normal text-[#555]">{label}</Label>{onForgot && <button type="button" onClick={onForgot} className="text-[11px] font-medium text-[#111827]">Forgot password?</button>}</div>
    <div className="relative"><Input type={show ? "text" : "password"} autoComplete={label === "Password" ? "current-password" : "new-password"} placeholder="••••••••" value={value} onChange={(e) => setValue(e.target.value)} className={`${inputClass} pr-11`} /><button type="button" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow(!show)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#aaa]">{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>
  </div>;
}

function Messages({ error, success }: { error: string; success: string }) {
  return <>{error && <p className="text-[13px] font-medium text-red-500">{error}</p>}{success && <p className="text-[13px] font-medium text-blue-600">{success}</p>}</>;
}

function SubmitButton({ loading, children }: { loading: boolean; children: React.ReactNode }) {
  return <button type="submit" disabled={loading} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[13px] font-semibold text-white disabled:opacity-70" style={{ background: "linear-gradient(135deg, #2563EB, #111827)" }}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>{children}<ArrowRight className="h-3.5 w-3.5" /></>}</button>;
}

function BackButton({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} className="w-full text-center text-[13px] font-medium text-[#888]">Back to login</button>;
}

function TelegramCard() {
  return <a href="https://t.me/boostlypro" target="_blank" rel="noopener noreferrer" className="mt-8 flex items-center gap-3 rounded-xl border border-black/[0.06] bg-white p-3.5 transition-colors hover:bg-white/80"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0088cc15]"><svg className="h-4 w-4 fill-[#0088cc]" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.27-.02-.11.02-1.93 1.23-5.46 3.62-.51.35-.98.53-1.39.52-.46-.01-1.33-.26-1.98-.48-.8-.27-1.43-.42-1.37-.89.03-.25.38-.51 1.03-.78 4.04-1.76 6.74-2.92 8.09-3.48 3.85-1.61.8-1.88 1.77-1.88.21 0 .69.05.99.23.32.19.43.46.46.72.02.16.01.32-.01.48z" /></svg></div><div><p className="text-[12px] font-semibold text-[#111827]">Join our Telegram</p><p className="text-[11px] text-[#999]">Updates &amp; support</p></div></a>;
}