import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { trpcClient } from '../lib/trpc'

export const MAL_OAUTH_STATE_KEY = 'dango_mal_oauth_state'

export function useMalAuthCallback(): boolean {
  const queryClient = useQueryClient()
  const [connecting, setConnecting] = useState(false)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const state = params.get('state')
    if (!state?.startsWith('mal:')) return
    const code = params.get('code')
    const expected = sessionStorage.getItem(MAL_OAUTH_STATE_KEY)
    sessionStorage.removeItem(MAL_OAUTH_STATE_KEY)
    window.history.replaceState(null, '', window.location.pathname)
    if (state !== expected || !code || params.has('error')) {
      toast.error('MyAnimeList login was cancelled or expired. Connect again.')
      return
    }
    setConnecting(true)
    trpcClient.tracker.malAuth
      .mutate({ code, state })
      .then((data) => {
        toast.success(`Connected to MyAnimeList as ${data.user.name}`)
        queryClient.invalidateQueries({ queryKey: ['trackerStatus'] })
      })
      .catch((err: Error) => toast.error(err.message))
      .finally(() => setConnecting(false))
  }, [queryClient])
  return connecting
}
