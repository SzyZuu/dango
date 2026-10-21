export interface AnilistMedia {
  id: number
  idMal: number | null
  title?: { romaji?: string; english?: string; native?: string }
  bannerImage?: string | null
  coverImage?: { extraLarge?: string; large?: string; medium?: string; color?: string }
  description?: string | null
  genres?: string[]
  averageScore?: number | null
  meanScore?: number | null
  format?: string
  status?: string
  episodes?: number | null
  duration?: number | null
  season?: string
  seasonYear?: number | null
  startDate?: { year?: number; month?: number; day?: number }
  endDate?: { year?: number; month?: number; day?: number }
  countryOfOrigin?: string
  isAdult?: boolean
  synonyms?: string[]
  trending?: number
  popularity?: number
  favourites?: number
  tags?: { id: number; name: string; rank: number; isMediaSpoiler: boolean }[]
  studios?: { nodes?: { id: number; name: string }[] }
  nextAiringEpisode?: { episode: number; timeUntilAiring: number; airingAt: number } | null
  trailer?: { id: string; site: string; thumbnail?: string } | null
  rankings?: {
    id: number
    rank: number
    type: string
    format: string
    allTime: boolean
    context: string
  }[]
  siteUrl?: string
}

export type AnilistSort =
  | 'TRENDING_DESC'
  | 'POPULARITY_DESC'
  | 'SCORE_DESC'
  | 'FAVOURITES_DESC'
  | 'ID_DESC'
  | 'START_DATE_DESC'
  | 'END_DATE_DESC'
  | 'EPISODES_DESC'
  | 'UPDATED_AT_DESC'

export interface GenreTagLists {
  genres: string[]
  tags: string[]
}

export interface MangaMeta {
  id: number
  title: { romaji?: string; english?: string; native?: string }
  cover?: string
}

export interface AnilistSearchOptions {
  query?: string
  page?: number
  perPage?: number
  format?: string
  status?: string
  season?: string
  seasonYear?: number
  countryOfOrigin?: string
  genre?: string | string[]
  genre_in?: string[]
  tag?: string | string[]
  tag_in?: string[]
  genre_not_in?: string[]
  tag_not_in?: string[]
  averageScore_greater?: number
  episodes_greater?: number
  isAdult?: boolean
  sort?: string
}
