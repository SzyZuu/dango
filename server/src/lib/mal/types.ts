export interface MalCacheStore {
  get(key: string): { payload: string; fresh: boolean } | null
  put(key: string, payload: string, ttlSeconds?: number): void
}

export interface ScrapedSearchEntry {
  id: number
  idMal: number
  url: string
  title: string
  imageUrl: string | null
  synopsis: string | null
  type: string | null
  episodes: number | null
  score: number | null
}

export interface ScrapedDetail {
  id: number
  idMal: number
  url: string
  title: string
  titleEnglish: string | null
  titleJapanese: string | null
  imageUrl: string | null
  synopsis: string | null
  type: string | null
  episodes: number | null
  status: string | null
  score: number | null
  rating: string | null
  genres: string[]
}
