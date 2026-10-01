import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

export function useMaintenanceMode() {
  return { isMaintenanceMode: false };
}
