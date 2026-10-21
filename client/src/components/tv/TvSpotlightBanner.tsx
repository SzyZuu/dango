import React, { useMemo } from 'react'
import { useNavigate } from 'react-router'
import SpotlightBannerShell, { type SpotlightSlide } from '../common/SpotlightBanner'
import { MOVIE_GENRES, TV_GENRES, tvDetailPath } from '../../lib/tv'
import { truncate } from '../../lib/utils'

interface TvSpotlightItem {
  id: number
  title: string
  year: string
  type: string
  image: string
  backdrop: string
  overview: string
  vote_average: number
  genre_ids: number[]
}

interface TvSpotlightBannerProps {
  items: TvSpotlightItem[]
}

const TvSpotlightBanner: React.FC<TvSpotlightBannerProps> = ({ items }) => {
  const navigate = useNavigate()

  const slides = useMemo<SpotlightSlide[]>(
    () =>
      items.slice(0, 6).map((item) => {
        const path = tvDetailPath(item.type, item.id)
        return {
          key: String(item.id),
          bannerSrc: item.backdrop ? item.backdrop : item.image,
          posterSrc: item.image,
          posterAlt: item.title,
          title: item.title,
          detailTo: path,
          score: item.vote_average > 0 ? Number(item.vote_average).toFixed(1) : null,
          metaItems: [item.type === 'tv' ? 'TV Show' : 'Movie', item.year].filter(Boolean),
          tags: item.genre_ids
            .slice(0, 3)
            .map((id) => MOVIE_GENRES[id] ?? TV_GENRES[id])
            .filter(Boolean),
          synopsis: truncate(item.overview, 200),
          primaryLabel: 'Watch Now',
          primaryIcon: 'play',
          onPrimary: () => navigate(path),
          onDetails: () => navigate(path),
        }
      }),
    [items, navigate]
  )

  return <SpotlightBannerShell slides={slides} eyebrow="TV Spotlight" />
}

export default TvSpotlightBanner
