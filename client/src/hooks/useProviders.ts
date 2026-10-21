import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '../lib/fetchApi'
import type { ProviderOption } from '../types/providers'
import { qk } from '../lib/queryKeys'

const STALE_5_MIN = 5 * 60 * 1000

export const useProviders = () => {
  const query = useQuery({
    queryKey: [qk.providers],
    queryFn: () => fetchApi('/api/providers') as Promise<ProviderOption[]>,
    staleTime: STALE_5_MIN,
    retry: 1,
  })
  const server = Array.isArray(query.data) ? query.data : null
  const options: ProviderOption[] = useMemo(
    () => (server && server.length > 0 ? server.filter((p) => p.loaded) : []),
    [server]
  )
  return { ...query, options, isFallback: !server || server.length === 0 }
}
