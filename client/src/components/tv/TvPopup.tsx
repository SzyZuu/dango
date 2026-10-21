import React, { useMemo, useState, useEffect } from 'react'
import { tvDetailPath, tvWatchPath, buildTvId } from '../../lib/tv'
import { useToggleTvBookmark } from '../../hooks/useTvLibrary'
import { trpcClient } from '../../lib/trpc'
import MediaPopup from '../common/MediaPopup'
import type { MediaPopupMeta } from '../common/MediaPopup'
import type { TvItem } from './TvCard'
import { truncate } from '../../lib/utils'

interface TvPopupDetails {
  overview?: string
  genres?: { id: number; name: string }[]
  vote_average?: number
  vote_count?: number
  status?: string
  number_of_seasons?: number
  number_of_episodes?: number
}

interface TvPopupProps {
  item: TvItem
  anchorRect: DOMRect
  onMouseEnter: () => void
  onMouseLeave: () => void
  onRequestClose?: () => void
}

const TvPopup: React.FC<TvPopupProps> = ({
  item,
  anchorRect,
  onMouseEnter,
  onMouseLeave,
  onRequestClose,
}) => {
  const [details, setDetails] = useState<TvPopupDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const { toggle, bookmarkedIds } = useToggleTvBookmark()

  const mediaId = buildTvId(item.type, item.id)
  const inWatchlist = bookmarkedIds.has(mediaId)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    trpcClient.tv.details
      .query({ type: item.type, id: String(item.id) })
      .then((data) => {
        if (!cancelled) {
          setDetails({
            overview: data.overview,
            vote_average: data.vote_average,
            number_of_seasons: data.number_of_seasons,
          })
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [item.id, item.type])

  const genres = useMemo(() => {
    if (!details?.genres) return []
    return details.genres.slice(0, 4).map((g) => g.name)
  }, [details?.genres])

  const meta: MediaPopupMeta[] = []
  if (details?.vote_average != null && details.vote_average > 0) {
    meta.push({ icon: 'star', label: Number(details.vote_average).toFixed(1), accent: true })
  }
  meta.push({ icon: 'tv', label: item.type === 'tv' ? 'TV Show' : 'Movie' })
  if (item.year) meta.push({ label: item.year })
  if (details?.status) meta.push({ label: details.status })

  return (
    <MediaPopup
      anchorRect={anchorRect}
      title={item.title}
      loading={loading}
      meta={meta}
      genres={genres}
      synopsis={truncate(details?.overview, 200)}
      primaryAction={{ to: tvWatchPath(item.type, item.id), label: 'Watch now', icon: 'play' }}
      secondaryAction={{
        to: tvDetailPath(item.type, item.id),
        label: 'Details',
        icon: 'info-circle',
      }}
      bookmarked={inWatchlist}
      onToggleBookmark={() =>
        toggle({
          tmdbId: item.id,
          mediaType: item.type,
          title: item.title,
          poster: item.image,
          year: item.year,
        })
      }
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onRequestClose={onRequestClose}
    />
  )
}

export default TvPopup
