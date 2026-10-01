import { api } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';

export type TransactionFilter = 'all' | 'deposit' | 'withdrawal' | 'order' | 'refund';

export function useTransactions(filter: TransactionFilter = 'all') {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['transactions', user?.id, filter],
    queryFn: async () => {
      const { transactions } = await api.getWallet();
      let data = transactions || [];
      if (filter !== 'all') {
        data = data.filter((t: any) => t.type === filter);
      }
      return data;
    },
    enabled: !!user?.id,
    staleTime: 15000,
  });
}
