import { protectedProcedure, router } from '../index.js'
import { getWatchlistDiscoveryStatus, triggerWatchlistDiscovery } from '../../lib/watchlist-discovery.js'

export const discoveryRouter = router({
  status: protectedProcedure.query(() => {
    return getWatchlistDiscoveryStatus()
  }),
  refresh: protectedProcedure.mutation(() => {
    const started = triggerWatchlistDiscovery()
    return { success: true, started, ...getWatchlistDiscoveryStatus() }
  }),
})
