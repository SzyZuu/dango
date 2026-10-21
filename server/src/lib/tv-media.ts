import type { TvMediaRequest } from '../providers/tv.types.js'

// the one place that builds a tv media request, the defaults included
export function buildTvMediaRequest(params: {
  tmdbId: number
  type: 'movie' | 'tv'
  season?: number
  episode?: number
  title?: string
  year?: string
  imdbId?: string
  totalSeasons?: number
}): TvMediaRequest {
  return {
    tmdbId: params.tmdbId,
    type: params.type,
    season: params.season || 1,
    episode: params.episode || 1,
    title: params.title || '',
    year: params.year || '',
    imdbId: params.imdbId || '',
    totalSeasons: params.totalSeasons || 1,
  }
}
