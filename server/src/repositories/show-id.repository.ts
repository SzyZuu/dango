import type { DatabaseWrapper } from '../db.js'
import { WatchlistRepository } from './watchlist.repository.js'
import { ShowsMetaRepository } from './shows-meta.repository.js'

export async function rewriteShowId(
  tx: DatabaseWrapper,
  from: string,
  to: string,
  opts: { anilistId: number; thumbnail?: string }
): Promise<void> {
  const sourceWatchlist = (await WatchlistRepository.getById(tx, from)) as
    { thumbnail?: string } | undefined
  const sourceMeta = (await ShowsMetaRepository.getById(tx, from)) as
    { thumbnail?: string } | undefined

  tx.run('UPDATE OR IGNORE watchlist SET id = ?, thumbnail = ? WHERE id = ?', [
    to,
    opts.thumbnail || sourceWatchlist?.thumbnail || '',
    from,
  ])
  tx.run('DELETE FROM watchlist WHERE id = ?', [from])

  tx.run('UPDATE OR IGNORE shows_meta SET id = ?, anilistId = ?, thumbnail = ? WHERE id = ?', [
    to,
    opts.anilistId,
    opts.thumbnail || sourceMeta?.thumbnail || '',
    from,
  ])
  tx.run('DELETE FROM shows_meta WHERE id = ?', [from])

  tx.run('UPDATE OR IGNORE watched_episodes SET showId = ? WHERE showId = ?', [to, from])
  tx.run('DELETE FROM watched_episodes WHERE showId = ?', [from])

  tx.run('UPDATE OR IGNORE queue SET showId = ? WHERE showId = ?', [to, from])
  tx.run('DELETE FROM queue WHERE showId = ?', [from])

  tx.run('UPDATE OR IGNORE dismissed_notifications SET showId = ? WHERE showId = ?', [to, from])
  tx.run('DELETE FROM dismissed_notifications WHERE showId = ?', [from])

  tx.run('UPDATE OR IGNORE discovered_notifications SET showId = ? WHERE showId = ?', [to, from])
  tx.run('DELETE FROM discovered_notifications WHERE showId = ?', [from])
}
