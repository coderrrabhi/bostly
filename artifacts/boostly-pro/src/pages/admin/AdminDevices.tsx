import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Smartphone, Trash2, RotateCcw, LogOut, Search } from "lucide-react";
import { apiUrl } from "@/lib/apiBase";

type Device = { device_id: string; user_agent: string | null; ip: string | null; first_seen_at: string; last_seen_at: string; active: boolean };
type Row = { user_id: string; email: string; max_devices: number; is_admin: boolean; devices: Device[] };

async function call<T = { ok: boolean }>(body: Record<string, unknown>): Promise<T> {
  const r = await fetch(apiUrl("/admin/devices"), { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || "Something went wrong.");
  return data as T;
}

function deviceName(ua: string | null) {
  if (!ua) return "Unknown device";
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iPhone/iPad" : /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "Device";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${os} · ${br}`;
}

export default function AdminDevices() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const { data, isLoading } = useQuery({ queryKey: ["admin-devices", applied], queryFn: () => call<{ users: Row[] }>({ action: "list", search: applied }) });
  const m = useMutation({
    mutationFn: call,
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["admin-devices"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Smartphone className="h-6 w-6 text-primary" /> Device Access</h1>
            <p className="text-sm text-muted-foreground">Each Gmail can log in on 1 device only. Allow more devices or remove a device here.</p>
          </div>
          <Button variant="destructive" disabled={m.isPending} onClick={() => { if (confirm("Log out every user from every device? (You stay logged in)")) m.mutate({ action: "logout_all" }); }}>
            <LogOut className="h-4 w-4 mr-2" /> Log out all users
          </Button>
        </div>

        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setApplied(search); }}>
          <Input placeholder="Search Gmail…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Button type="submit" variant="outline"><Search className="h-4 w-4" /></Button>
        </form>

        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        <div className="space-y-3">
          {data?.users.map((u) => (
            <Card key={u.user_id} className="glass-card">
              <CardContent className="p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold break-all">{u.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {u.is_admin ? "Admin — no device limit" : `${u.devices.length} of ${u.max_devices} device${u.max_devices > 1 ? "s" : ""} used`}
                    </p>
                  </div>
                  {!u.is_admin && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Allowed devices</span>
                      <select
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                        value={u.max_devices}
                        onChange={(e) => m.mutate({ action: "set_limit", userId: u.user_id, maxDevices: Number(e.target.value) })}
                      >
                        {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                      <Button size="sm" variant="outline" disabled={m.isPending || u.devices.length === 0}
                        onClick={() => { if (confirm(`Remove all devices of ${u.email}? They will be logged out and can log in on a new device.`)) m.mutate({ action: "reset_user", userId: u.user_id }); }}>
                        <RotateCcw className="h-4 w-4 mr-1" /> Reset
                      </Button>
                    </div>
                  )}
                </div>
                {u.devices.length > 0 && (
                  <div className="space-y-2">
                    {u.devices.map((d) => (
                      <div key={d.device_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2 text-sm">
                        <div>
                          <span className="font-medium">{deviceName(d.user_agent)}</span>{" "}
                          {d.active ? <Badge variant="secondary">Logged in</Badge> : <Badge variant="outline">Logged out</Badge>}
                          <p className="text-xs text-muted-foreground">IP {d.ip || "-"} · last used {new Date(d.last_seen_at).toLocaleString()}</p>
                        </div>
                        <Button size="sm" variant="ghost" disabled={m.isPending}
                          onClick={() => { if (confirm("Remove this device? It will be logged out.")) m.mutate({ action: "remove_device", userId: u.user_id, deviceId: d.device_id }); }}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
          {data && data.users.length === 0 && <p className="text-sm text-muted-foreground">No users found.</p>}
        </div>
      </div>
    </DashboardLayout>
  );
}
