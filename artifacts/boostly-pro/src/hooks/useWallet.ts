import { api } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';

export function useWallet() {
  const { user } = useAuth();

  const { data: wallet, isLoading, error } = useQuery({
    queryKey: ['wallet', user?.id],
    queryFn: async () => {
      const { data, error } = await api.getWallet().then(res => ({ data: res.wallet, error: null }));
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
    staleTime: 10000,
  });

  return { wallet, isLoading, error };
}
