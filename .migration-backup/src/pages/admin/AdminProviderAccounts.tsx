import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, Activity, Link as LinkIcon, Save, Clock, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Account {
  id: string;
  user_id: string;
  email: string;
  name: string;
  api_url: string;
  api_key_hint: string;
  priority: number;
  is_active: boolean;
  balance_cached: number | null;
  balance_currency: string | null;
  last_tested_at: string | null;
  last_test_ok: boolean | null;
  last_test_error: string | null;
  active_runs: number;
  mapped_services: number;
  created_at: string;
  updated_at: string;
}

function PriorityCell({ account, onSave }: { account: Account, onSave: (id: string, p: number) => void }) {
  const [val, setVal] = useState(account.priority.toString());
  const [lastPropVal, setLastPropVal] = useState(account.priority.toString());

  useEffect(() => {
    if (account.priority.toString() !== lastPropVal) {
      setVal(account.priority.toString());
      setLastPropVal(account.priority.toString());
    }
  }, [account.priority, lastPropVal]);

  const changed = val !== account.priority.toString();

  return (
    <div className="flex items-center gap-1">
      <Input 
        type="number" 
        className="w-16 h-8 text-center px-1" 
        value={val} 
        onChange={e => setVal(e.target.value)} 
      />
      {changed && (
        <Button 
          size="icon" 
          variant="ghost" 
          className="h-8 w-8 text-primary" 
          onClick={() => {
            const num = parseInt(val, 10);
            if (!isNaN(num)) {
              onSave(account.id, num);
            }
          }}
        >
          <Save className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

export default function AdminProviderAccounts() {
  const queryClient = useQueryClient();

  const { data: accounts = [], isLoading, isError, error } = useQuery({
    queryKey: ["admin-provider-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("admin-provider-accounts", {
        body: { op: "list" },
      });
      if (error) throw new Error(error.message || "Failed to load accounts");
      return (data?.accounts || []) as Account[];
    },
    refetchInterval: 30000,
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: { id: string; priority?: number; is_active?: boolean }) => {
      const { data, error } = await supabase.functions.invoke("admin-provider-accounts", {
        body: { op: "update", ...payload },
      });
      if (error) throw new Error(error.message || "Failed to update account");
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin-provider-accounts"] });
      if (variables.priority !== undefined) {
        toast.success("Priority saved");
      }
    },
    onError: (err: any) => {
      toast.error(err.message || "Update failed");
    }
  });

  const refreshBalanceMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke("admin-provider-accounts", {
        body: { op: "refresh_balance", id },
      });
      if (error) throw new Error(error.message || "Failed to refresh balance");
      return data;
    },
    onSuccess: () => {
      toast.success("Balance refreshed");
      queryClient.invalidateQueries({ queryKey: ["admin-provider-accounts"] });
    },
    onError: (err: any) => {
      toast.error(err.message || "Balance refresh failed");
    }
  });

  const uniqueCurrencies = new Set(accounts.filter(a => a.balance_currency).map(a => a.balance_currency));
  const isSingleCurrency = uniqueCurrencies.size === 1;
  const currency = isSingleCurrency ? Array.from(uniqueCurrencies)[0] : null;
  const totalBalance = isSingleCurrency ? accounts.reduce((acc, a) => acc + (a.balance_cached || 0), 0) : null;
  const activeCount = accounts.filter(a => a.is_active).length;
  const totalActiveRuns = accounts.reduce((acc, a) => acc + a.active_runs, 0);

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="p-4 md:p-6 space-y-6">
          <div className="animate-pulse space-y-4">
             <div className="h-8 w-64 bg-muted rounded" />
             <div className="h-24 bg-muted rounded-xl" />
             <div className="h-[400px] bg-muted rounded-xl" />
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (isError) {
    return (
      <DashboardLayout>
        <div className="p-4 md:p-6">
          <Card className="border-destructive/50 bg-destructive/5">
            <CardContent className="flex flex-col items-center py-10 text-destructive">
              <AlertCircle className="h-10 w-10 mb-4" />
              <h3 className="text-lg font-semibold">Error Loading Accounts</h3>
              <p className="text-sm mt-1">{error instanceof Error ? error.message : "Unknown error"}</p>
              <Button variant="outline" className="mt-4" onClick={() => queryClient.invalidateQueries({ queryKey: ["admin-provider-accounts"] })}>
                Retry
              </Button>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Provider Operations</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor and manage active provider routing. Accounts rotate lowest-number-first.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Accounts</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{accounts.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Active Accounts</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">{activeCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Current Active Runs</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalActiveRuns}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Combined Balance</CardTitle>
            </CardHeader>
            <CardContent>
              {isSingleCurrency ? (
                <div className="text-2xl font-bold">
                  {new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(totalBalance || 0)}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground pt-1 font-medium">
                  {uniqueCurrencies.size === 0 ? "No balances available" : "Multiple currencies mixed"}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {!accounts.length ? (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center flex flex-col items-center">
              <Activity className="h-10 w-10 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">No Provider Accounts Found</h3>
              <p className="text-muted-foreground text-sm max-w-sm mt-1">
                Tenants can add their provider credentials from "My Providers" in their dashboard.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-md border bg-card overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>API Details</TableHead>
                  <TableHead className="w-24">Priority</TableHead>
                  <TableHead className="w-24 text-center">Active</TableHead>
                  <TableHead>Health Check</TableHead>
                  <TableHead>Balance</TableHead>
                  <TableHead className="text-right">Usage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((account) => (
                  <TableRow key={account.id} className={!account.is_active ? "opacity-60 bg-muted/20" : ""}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{account.name}</span>
                        <span className="text-xs text-muted-foreground">{account.email}</span>
                        <span className="text-[10px] text-muted-foreground/70">{account.user_id}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1 text-sm">
                        <span className="truncate max-w-[200px]" title={account.api_url}>
                          {account.api_url}
                        </span>
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded w-max text-muted-foreground">
                          {account.api_key_hint}
                        </code>
                      </div>
                    </TableCell>
                    <TableCell>
                      <PriorityCell 
                        account={account} 
                        onSave={(id, p) => updateMutation.mutate({ id, priority: p })} 
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch 
                        checked={account.is_active}
                        onCheckedChange={(c) => updateMutation.mutate({ id: account.id, is_active: c })}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1 text-sm">
                        <div className="flex items-center gap-1.5">
                          {account.last_test_ok ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                          ) : account.last_test_error ? (
                            <XCircle className="h-3.5 w-3.5 text-destructive" />
                          ) : (
                            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                          <span className={account.last_test_ok ? "text-green-600 dark:text-green-400 font-medium" : account.last_test_error ? "text-destructive font-medium" : "text-muted-foreground"}>
                            {account.last_test_ok ? "Healthy" : account.last_test_error ? "Failing" : "Pending"}
                          </span>
                        </div>
                        {account.last_tested_at && (
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(account.last_tested_at), { addSuffix: true })}
                          </span>
                        )}
                        {account.last_test_error && (
                          <span className="text-xs text-destructive truncate max-w-[150px]" title={account.last_test_error}>
                            {account.last_test_error}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {account.balance_cached !== null ? (
                            new Intl.NumberFormat('en-US', { style: 'currency', currency: account.balance_currency || 'USD' }).format(account.balance_cached)
                          ) : (
                            <span className="text-muted-foreground font-normal">--</span>
                          )}
                        </span>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-6 w-6 text-muted-foreground hover:text-foreground" 
                          onClick={() => refreshBalanceMutation.mutate(account.id)}
                          disabled={refreshBalanceMutation.isPending && refreshBalanceMutation.variables === account.id}
                        >
                          <RefreshCw className={`h-3 w-3 ${refreshBalanceMutation.isPending && refreshBalanceMutation.variables === account.id ? "animate-spin" : ""}`} />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end gap-1.5">
                        <Badge variant="secondary" className="font-normal text-xs flex gap-1.5 items-center w-max">
                          <Activity className="h-3 w-3" />
                          {account.active_runs} runs
                        </Badge>
                        <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <LinkIcon className="h-3 w-3" />
                          {account.mapped_services} services
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
