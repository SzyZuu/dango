export type TvMediaType = 'movie' | 'tv'

export const normalizeTvMediaType = (raw: unknown): TvMediaType =>
  String(raw).toLowerCase() === 'movie' ? 'movie' : 'tv'

export const buildTvId = (mediaType: string, tmdbId: number | string): string =>
  `${normalizeTvMediaType(mediaType)}:${tmdbId}`

export const tvDetailPath = (mediaType: string, tmdbId: number | string): string => {
  const t = normalizeTvMediaType(mediaType)
  return `/tv/${tmdbId}?type=${t}`
}

export const tvWatchPath = (
  mediaType: string,
  tmdbId: number | string,
  season?: number,
  episode?: number
): string => {
  const params = new URLSearchParams()
  params.set('type', normalizeTvMediaType(mediaType))
  if (season !== undefined) params.set('s', String(season))
  if (episode !== undefined) params.set('e', String(episode))
  return `/tv/${tmdbId}/watch?${params.toString()}`
}

export const isTvAdult = (item: { adult?: boolean | number | null }): boolean =>
  item.adult === true || item.adult === 1

export const TV_GENRES: Record<number, string> = {
  10759: 'Action & Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  10762: 'Kids',
  9648: 'Mystery',
  10765: 'Sci-Fi & Fantasy',
  37: 'Western',
}

export const MOVIE_GENRES: Record<number, string> = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Sci-Fi',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
}
