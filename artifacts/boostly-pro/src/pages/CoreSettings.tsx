import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageMeta } from "@/components/seo/PageMeta";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  Brain, Camera, Info, Loader2, Mail, Percent, Save, Settings as SettingsIcon,
  LogOut, Shield, Sparkles, User,
} from "lucide-react";

const ratioMeta: Record<string, { label: string; emoji: string }> = {
  views: { label: "Views", emoji: "👁️" }, likes: { label: "Likes", emoji: "❤️" },
  comments: { label: "Comments", emoji: "💬" }, saves: { label: "Saves", emoji: "📥" },
  shares: { label: "Shares", emoji: "🔄" }, reposts: { label: "Reposts", emoji: "🔁" },
  followers: { label: "Followers", emoji: "👥" }, subscribers: { label: "Subscribers", emoji: "🔔" },
  watch_hours: { label: "Watch Hours", emoji: "⏱️" }, retweets: { label: "Retweets", emoji: "🔃" },
};

const initialRatios = { views: 100, likes: 5, comments: 2, saves: 1, shares: 1, reposts: 0.5, followers: 2, subscribers: 3, watch_hours: 5, retweets: 4 };
type RatioKey = keyof typeof initialRatios;

export default function CoreSettings() {
  const { profile, refreshProfile, signOut, isLoading } = useAuth();
  const user: any = null;
  const navigate = useNavigate();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [fullName, setFullName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isOrganicMode, setIsOrganicMode] = useState(false);
  const [ratios, setRatios] = useState(initialRatios);

  useEffect(() => {
    setFullName(profile?.fullName ?? profile?.full_name ?? "");
    setCurrency(profile?.currency ?? "USD");
    try {
      const saved = localStorage.getItem("organic_settings");
      if (saved) {
        const parsed = JSON.parse(saved);
        setIsOrganicMode(parsed.isOrganicMode ?? false);
        if (parsed.ratios) setRatios({ ...initialRatios, ...parsed.ratios });
      }
    } catch { /* A malformed local preference should not block settings. */ }
  }, [profile]);

  useEffect(() => {
    let active = true;
    api.getSettings().then((settings) => {
      if (!active) return;
      setFullName(settings?.fullName ?? settings?.full_name ?? "");
      setCurrency(settings?.currency ?? "USD");
    }).catch(() => {
      // The profile supplied by the current auth session remains usable offline.
    });
    return () => { active = false; };
  }, []);

  async function handlePhotoUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !user) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("File too large", { description: "Max 2MB allowed" });
      return;
    }
    setUploadingPhoto(true);
    try {
      await user.setProfileImage({ file });
      toast.success("📸 Photo Updated!", { description: "Profile photo saved successfully." });
    } catch (error) {
      toast.error("Upload Failed", { description: error instanceof Error ? error.message : "Could not upload photo" });
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function save() {
    setIsSaving(true);
    try {
      await api.updateSettings({ fullName: fullName.trim() || null, currency });
      localStorage.setItem("organic_settings", JSON.stringify({ isOrganicMode, ratios }));
      await refreshProfile();
      toast.success("Settings Saved", { description: "Your preferences have been updated successfully." });
    } catch (error) {
      toast.error("Error", { description: error instanceof Error ? error.message : "Failed to update profile" });
    } finally {
      setIsSaving(false);
    }
  }

  const updateRatio = (key: RatioKey, value: number) => setRatios((previous) => ({ ...previous, [key]: value }));
  const ratioCard = (key: RatioKey, accent: string) => {
    const meta = ratioMeta[key];
    return <div key={key} className={`space-y-3 p-4 rounded-2xl bg-background/50 border border-border group ${accent}`}>
      <div className="flex justify-between items-center">
        <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground group-hover:text-primary transition-colors flex items-center gap-1.5"><span>{meta.emoji}</span> {meta.label}{["views", "likes", "comments"].includes(key) ? " Ratio" : ""}</Label>
        <span className="text-lg font-mono font-bold text-primary">{ratios[key]}%</span>
      </div>
      <div className="px-1"><Slider value={[ratios[key]]} onValueChange={([value]) => updateRatio(key, value)} max={100} step={1} className="py-4" /></div>
      <div className="flex justify-between text-[10px] text-muted-foreground/60"><span>0%</span><span>50%</span><span>100%</span></div>
    </div>;
  };

  if (isLoading) return <DashboardLayout><div className="flex items-center justify-center min-h-[400px]"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></DashboardLayout>;

  return <DashboardLayout>
    <PageMeta title="Account Settings" description="Update your Boostly Pro profile, password, currency, and preferences." canonicalPath="/settings" noIndex />
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6 pb-8">
      <div className="relative overflow-hidden glass-card p-6 sm:p-8 bg-gradient-to-r from-primary/5 via-transparent to-primary/10">
        <div className="relative z-10 flex items-center gap-3 mb-2"><div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg"><SettingsIcon className="h-6 w-6 text-primary-foreground" /></div><div><h1 className="text-2xl sm:text-3xl font-bold text-foreground">Settings</h1><p className="text-sm text-muted-foreground">Manage your account and preferences</p></div></div>
        <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-bl from-primary/10 to-transparent rounded-full blur-3xl" />
      </div>

      <Card className="glass-card border-2 border-border"><CardHeader><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><User className="h-5 w-5 text-primary" /></div><div><CardTitle>Profile Information</CardTitle><CardDescription>Update your personal details</CardDescription></div></div></CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center gap-5"><div className="relative shrink-0">{user?.imageUrl ? <img src={user.imageUrl} alt="Profile" className="w-20 h-20 rounded-2xl object-cover border-2 border-primary/30 shadow-lg" /> : <div className="w-20 h-20 rounded-2xl bg-primary/10 border-2 border-primary/20 flex items-center justify-center"><User className="h-8 w-8 text-primary/50" /></div>}<button onClick={() => photoInputRef.current?.click()} disabled={uploadingPhoto} className="absolute -bottom-2 -right-2 w-7 h-7 rounded-full bg-primary flex items-center justify-center shadow-lg hover:bg-primary/90 transition-colors border-2 border-background">{uploadingPhoto ? <Loader2 className="h-3 w-3 text-white animate-spin" /> : <Camera className="h-3 w-3 text-white" />}</button><input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} /></div><div><p className="text-sm font-semibold text-foreground">{fullName || "Your Name"}</p><p className="text-xs text-muted-foreground mb-2">{profile?.email ?? user?.primaryEmailAddress?.emailAddress}</p><button onClick={() => photoInputRef.current?.click()} className="text-xs text-primary hover:underline font-medium">{user?.imageUrl ? "Change photo" : "Upload photo"}</button></div></div>
          <div className="grid gap-5 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="fullName" className="text-sm font-medium">Full Name</Label><Input id="fullName" value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Enter your name" className="h-11 rounded-xl border-2 border-border focus:border-primary" /></div><div className="space-y-2"><Label htmlFor="email" className="text-sm font-medium">Email Address</Label><div className="relative"><Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input id="email" value={profile?.email ?? user?.primaryEmailAddress?.emailAddress ?? ""} disabled className="h-11 pl-10 rounded-xl border-2 border-border bg-muted/50" /></div><p className="text-xs text-muted-foreground">Email cannot be changed</p></div></div>
          <div className="space-y-2 max-w-xs"><Label htmlFor="currency" className="text-sm font-medium">Currency</Label><select id="currency" className="h-11 w-full rounded-xl border-2 border-border bg-background px-3 text-sm focus:border-primary focus:outline-none" value={currency} onChange={(event) => setCurrency(event.target.value)}><option value="USD">USD</option><option value="INR">INR</option><option value="EUR">EUR</option></select></div>
          <Button onClick={save} disabled={isSaving} className="h-11 px-6 rounded-xl bg-gradient-to-r from-primary to-primary/80">{isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}Save Changes</Button>
        </CardContent></Card>

      <Card className="glass-card border-2 border-primary/40 bg-gradient-to-br from-primary/5 to-transparent overflow-hidden"><CardHeader className="relative"><div className="flex items-center justify-between"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center shadow-lg shadow-primary/10"><Brain className="h-5 w-5 text-primary" /></div><div><CardTitle className="flex items-center gap-2 text-foreground">AI Organic Automation <Badge variant="secondary" className="bg-primary/20 text-primary text-[10px] font-bold uppercase tracking-wider">PREMIUM</Badge></CardTitle><CardDescription>Configure your default organic settings</CardDescription></div></div><div className="flex items-center gap-3 bg-secondary/50 p-1.5 rounded-2xl border border-border"><span className={cn("text-[10px] font-bold uppercase px-2 py-1 rounded-lg transition-all", isOrganicMode ? "text-success bg-success/10" : "text-muted-foreground")}>{isOrganicMode ? "Enabled" : "Disabled"}</span><Switch checked={isOrganicMode} onCheckedChange={setIsOrganicMode} className="data-[state=checked]:bg-success" /></div></div></CardHeader>
        <CardContent className="space-y-6"><div className="p-4 rounded-2xl bg-secondary/30 border border-primary/20 flex gap-4 items-start"><div className="p-2 bg-primary/10 rounded-lg"><Sparkles className="h-4 w-4 text-primary" /></div><div className="space-y-1"><h4 className="text-sm font-bold text-foreground">What is Organic Mode?</h4><p className="text-xs text-muted-foreground leading-relaxed">When enabled, all your new orders will automatically use AI-generated delivery patterns. This creates unique growth curves for every order to look 100% natural to social algorithms.</p></div></div>
          <div className="space-y-6"><div className="flex items-center gap-2 mb-2"><Percent className="h-4 w-4 text-primary" /><h3 className="text-sm font-bold text-foreground">AI Organic Ratios — Universal</h3><Badge variant="secondary" className="bg-primary/10 text-primary text-[9px] uppercase tracking-wider">All Platforms</Badge></div><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{(["views", "likes", "comments"] as RatioKey[]).map((key) => ratioCard(key, "hover:border-primary/30"))}</div>
            <RatioGroup title="📸 Instagram & TikTok" badge="IG + TT" badgeClass="bg-green-500/10 text-green-400" keys={["saves", "shares", "reposts", "followers"]} render={ratioCard} grid="sm:grid-cols-2 lg:grid-cols-3" />
            <RatioGroup title="🎬 YouTube" badge="YT" badgeClass="bg-red-500/10 text-red-400" keys={["subscribers", "watch_hours"]} render={ratioCard} grid="sm:grid-cols-2" />
            <RatioGroup title="🐦 Twitter / X" badge="X" badgeClass="bg-sky-500/10 text-sky-400" keys={["retweets"]} render={ratioCard} grid="sm:grid-cols-2" />
            <div className="flex items-center gap-3 p-3 rounded-xl bg-primary/5 text-primary"><Info className="h-4 w-4 shrink-0" /><p className="text-[11px] font-medium">Ratios are calculated relative to your "Base Quantity". For example, if Views are 100% and Likes are 5%, an order of 10,000 Views will auto-generate 500 Likes. These apply to ALL your orders across all platforms.</p></div>
          </div><Button onClick={save} disabled={isSaving} className="w-full h-12 rounded-xl bg-gradient-to-r from-primary to-primary/80 shadow-lg shadow-primary/20 font-bold">{isSaving ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Save className="h-5 w-5 mr-2" />}Save AI Configuration</Button>
        </CardContent></Card>

      <Card className="glass-card border-2 border-border"><CardHeader><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center"><Shield className="h-5 w-5 text-warning" /></div><div><CardTitle>Change Password</CardTitle><CardDescription>Update your account password</CardDescription></div></div></CardHeader><CardContent className="space-y-5"><p className="text-sm text-muted-foreground">Password change karne ke liye Telegram support se contact karein.</p></CardContent></Card>
      <Card className="glass-card border-2 border-destructive/30"><CardContent className="p-5"><div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"><div><h3 className="font-bold text-foreground">Sign Out</h3><p className="text-sm text-muted-foreground">Sign out from your account on this device</p></div><Button variant="destructive" onClick={async () => { await signOut(); navigate("/auth"); }} className="h-11 px-6 rounded-xl"><LogOut className="h-4 w-4 mr-2" />Sign Out</Button></div></CardContent></Card>
    </div>
  </DashboardLayout>;
}

function RatioGroup({ title, badge, badgeClass, keys, render, grid }: { title: string; badge: string; badgeClass: string; keys: RatioKey[]; render: (key: RatioKey, accent: string) => React.ReactNode; grid: string }) {
  return <div><div className="flex items-center gap-2 mt-6 mb-2"><h3 className="text-sm font-bold text-foreground">{title}</h3><Badge variant="secondary" className={`${badgeClass} text-[9px] uppercase tracking-wider`}>{badge}</Badge></div><div className={`grid gap-4 ${grid}`}>{keys.map((key) => render(key, ""))}</div></div>;
}