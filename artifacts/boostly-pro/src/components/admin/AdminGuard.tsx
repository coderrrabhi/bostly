import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { Loader2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

/** Clerk/API-backed replacement for the legacy Supabase role query. */
export function AdminGuard({ children }: { children: ReactNode }) {
  const { user, isLoading, isAdmin } = useAuth();
  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }
  if (!user) return <Navigate to="/sign-in" replace />;
  if (!isAdmin) {
    return <div className="min-h-screen flex items-center justify-center"><div className="text-center p-8 bg-white/80 rounded-2xl shadow-lg max-w-md"><ShieldAlert className="w-16 h-16 text-red-500 mx-auto mb-4" /><h2 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h2><p className="text-gray-600">You don't have admin privileges.</p></div></div>;
  }
  return <>{children}</>;
}