import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Mail, Lock, User, Loader2, ArrowLeft, Shield, Zap, Eye, EyeOff, ArrowRight, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { z } from 'zod';
import logo from '@/assets/logo.png';
import { PageMeta } from '@/components/seo/PageMeta';


const loginSchema = z.object({
  email: z.string().trim().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

const signupSchema = z.object({
  email: z.string().trim().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  fullName: z.string().trim().min(2, 'Name must be at least 2 characters'),
});

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [showVerifyEmail, setShowVerifyEmail] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { signIn, signUp, user, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && user) navigate('/engagement-order');
  }, [user, isLoading, navigate]);

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccessMessage(''); setIsSubmitting(true);
    try {
      const trimmedEmail = email.trim().toLowerCase();
      if (!trimmedEmail || !z.string().email().safeParse(trimmedEmail).success) {
        setError('Please enter a valid email address'); setIsSubmitting(false); return;
      }
      const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, { redirectTo: `${window.location.origin}/auth` });
      if (error) setError(error.message); else setSuccessMessage('Password reset email sent! Check your inbox.');
    } catch { setError('Something went wrong.'); }
    finally { setIsSubmitting(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccessMessage(''); setIsSubmitting(true);
    try {
      if (isLogin) {
        const v = loginSchema.safeParse({ email, password });
        if (!v.success) { setError(v.error.errors[0].message); setIsSubmitting(false); return; }
        const { error } = await signIn(email, password);
        if (error) {
          const msg = error.message.toLowerCase();
          if (msg.includes('invalid login credentials')) setError('Incorrect email or password.');
          else if (msg.includes('email not confirmed')) setError('Please verify your email first.');
          else if (msg.includes('rate limit')) setError('Too many attempts. Try again in 5 mins.');
          else setError('Login failed.');
          setIsSubmitting(false); return;
        }
        navigate('/engagement-order', { replace: true });
      } else {
        const v = signupSchema.safeParse({ email, password, fullName });
        if (!v.success) { setError(v.error.errors[0].message); setIsSubmitting(false); return; }
        const { error } = await signUp(email, password, fullName);
        if (error) {
          const msg = error.message.toLowerCase();
          if (msg.includes('already registered')) setError('This email is already registered.');
          else if (msg.includes('rate limit')) setError('Too many attempts. Wait 5 minutes.');
          else setError(error.message || 'Signup failed.');
          setIsSubmitting(false); return;
        }
        setSuccessMessage('Account created successfully!');
        setTimeout(() => setIsLogin(true), 2000);
      }
    } catch (err: any) {
      if (!err?.message?.includes('abort')) setError('Something went wrong. Please try again.');
    } finally { setIsSubmitting(false); }
  };

  const inputClass = "h-12 rounded-xl border-[#dbe4f5] bg-white focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20 text-[#0B1220] font-medium px-4 placeholder:text-[#8892AB] transition-all";

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12" style={{ background: 'linear-gradient(180deg, #EAF1FF 0%, #F4F7FF 60%, #DCE7FF 100%)' }}>
      <PageMeta
        title={isLogin ? 'Sign in — Boostly Pro' : 'Create your account — Boostly Pro'}
        description="Sign in or create your free Boostly Pro account to launch organic Instagram, YouTube and TikTok growth campaigns. No credit card required."
        canonicalPath="/auth"
      />
      <div className="w-full max-w-[400px]">
          {/* Logo */}
          <div className="flex items-center justify-center gap-2.5 mb-10">
            <img src={logo} alt="Boostly Pro platform logo" className="w-10 h-10 rounded-xl object-cover shadow-sm" />
            <div className="flex flex-col">
              <span className="text-[16px] font-bold tracking-tight" style={{ color: '#111827' }}>Boostly Pro</span>
              <span className="text-[9px] font-bold uppercase tracking-[0.15em]" style={{ color: '#111827' }}>✦ Updated Version</span>
            </div>
          </div>

          <Link to="/" className="inline-flex items-center gap-1.5 text-[12px] font-medium mb-8" style={{ color: '#999' }}>
            <ArrowLeft className="w-3.5 h-3.5" /> Back to home
          </Link>

          <h1 className="text-2xl font-extrabold tracking-tight mb-1" style={{ color: '#111827', fontFamily: "'Outfit', system-ui, sans-serif" }}>
            {isForgotPassword ? 'Reset password' : isLogin ? 'Welcome back' : 'Create account'}
          </h1>
          <p className="text-[14px] mb-8" style={{ color: '#999' }}>
            {isForgotPassword ? 'Enter your email to receive a reset link.' : isLogin ? 'Sign in to your account.' : 'Get started for free.'}
          </p>

          {showVerifyEmail ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6" style={{ background: '#EAF1FF' }}>
                <Mail className="w-7 h-7" style={{ color: '#3b82f6' }} />
              </div>
              <h3 className="text-xl font-bold mb-2" style={{ color: '#111827' }}>Check your inbox</h3>
              <p className="text-[13px] mb-2" style={{ color: '#888' }}>Verification link sent to:</p>
              <p className="text-[13px] font-semibold mb-6" style={{ color: '#111827' }}>{email}</p>
              <button onClick={() => { setShowVerifyEmail(false); setIsLogin(true); }} className="text-[13px] font-semibold" style={{ color: '#111827' }}>
                ← Back to login
              </button>
            </div>
          ) : (
            <form onSubmit={isForgotPassword ? handleForgotPassword : handleSubmit} className="space-y-4">
              {isForgotPassword ? (
                <div className="space-y-4">
                  <div>
                    <Label className="text-[12px] font-semibold mb-1.5 block" style={{ color: '#555', textTransform: 'none', letterSpacing: 'normal' }}>Email</Label>
                    <Input type="email" placeholder="name@example.com" value={email} onChange={e => setEmail(e.target.value)} className={inputClass} />
                  </div>
                  {error && <p className="text-[13px] font-medium" style={{ color: '#ef4444' }}>{error}</p>}
                  {successMessage && <p className="text-[13px] font-medium" style={{ color: '#3b82f6' }}>{successMessage}</p>}
                  <button type="submit" disabled={isSubmitting} className="w-full h-11 rounded-xl text-[13px] font-semibold text-white flex items-center justify-center gap-2" style={{ background: 'linear-gradient(135deg, #2563EB, #111827)' }}>
                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Send reset link <ArrowRight className="w-3.5 h-3.5" /></>}
                  </button>
                  <button type="button" onClick={() => setIsForgotPassword(false)} className="w-full text-center text-[13px] font-medium" style={{ color: '#999' }}>
                    Back to login
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {!isLogin && (
                    <div>
                      <Label className="text-[12px] font-semibold mb-1.5 block" style={{ color: '#555', textTransform: 'none', letterSpacing: 'normal' }}>Full name</Label>
                      <Input placeholder="John Doe" value={fullName} onChange={e => setFullName(e.target.value)} className={inputClass} />
                    </div>
                  )}
                  <div>
                    <Label className="text-[12px] font-semibold mb-1.5 block" style={{ color: '#555', textTransform: 'none', letterSpacing: 'normal' }}>Email</Label>
                    <Input type="email" placeholder="name@example.com" value={email} onChange={e => setEmail(e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <Label className="text-[12px] font-semibold" style={{ color: '#555', textTransform: 'none', letterSpacing: 'normal' }}>Password</Label>
                      {isLogin && (
                        <button type="button" onClick={() => setIsForgotPassword(true)} className="text-[11px] font-medium" style={{ color: '#111827' }}>
                          Forgot password?
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <Input type={showPassword ? 'text' : 'password'} placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} className={`${inputClass} pr-11`} />
                      <button type="button" aria-label="Toggle password visibility" onClick={() => setShowPassword(!showPassword)} className="absolute right-3.5 top-1/2 -translate-y-1/2" style={{ color: '#bbb' }}>
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {error && <p className="text-[13px] font-medium" style={{ color: '#ef4444' }}>{error}</p>}
                  {successMessage && <p className="text-[13px] font-medium" style={{ color: '#3b82f6' }}>{successMessage}</p>}

                  <button type="submit" disabled={isSubmitting} className="w-full h-11 rounded-xl text-[13px] font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-70" style={{ background: 'linear-gradient(135deg, #2563EB, #111827)' }}>
                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <>{isLogin ? 'Sign in' : 'Create account'} <ArrowRight className="w-3.5 h-3.5" /></>}
                  </button>

                  <p className="text-center text-[13px]" style={{ color: '#999' }}>
                    {isLogin ? "Don't have an account? " : 'Already have an account? '}
                    <button type="button" onClick={() => { setIsLogin(!isLogin); setError(''); setSuccessMessage(''); }} className="font-semibold" style={{ color: '#111827' }}>
                      {isLogin ? 'Sign up' : 'Sign in'}
                    </button>
                  </p>
                </div>
              )}
            </form>
          )}

          {/* Telegram */}
          <a href="https://t.me/boostlypro" target="_blank" rel="noopener noreferrer" className="mt-8 flex items-center gap-3 p-3.5 rounded-xl transition-colors" style={{ border: '1px solid rgba(0,0,0,.06)', background: 'white' }}>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: '#0088cc15' }}>
              <svg className="w-4 h-4 fill-[#0088cc]" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.27-.02-.11.02-1.93 1.23-5.46 3.62-.51.35-.98.53-1.39.52-.46-.01-1.33-.26-1.98-.48-.8-.27-1.43-.42-1.37-.89.03-.25.38-.51 1.03-.78 4.04-1.76 6.74-2.92 8.09-3.48 3.85-1.61.8-1.88 1.77-1.88.21 0 .69.05.99.23.32.19.43.46.46.72.02.16.01.32-.01.48z" /></svg>
            </div>
            <div>
              <p className="text-[12px] font-semibold" style={{ color: '#111827' }}>Join our Telegram</p>
              <p className="text-[11px]" style={{ color: '#999' }}>Updates & support</p>
            </div>
          </a>
      </div>
    </div>
  );
}
