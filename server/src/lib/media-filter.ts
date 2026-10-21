import type { AnilistMedia } from './anilist/index.js'
import { SEASON_MONTHS } from './media-vocab.js'

export interface MediaFilterOptions {
  format?: string
  genre_not_in?: string[]
  averageScore_greater?: number
  episodes_greater?: number
  isAdult?: boolean
  season?: string
  seasonYear?: number
  sort?: string
  hasQuery?: boolean
}

export function startDateRank(m: AnilistMedia): number {
  return (
    (m.startDate?.year ?? 0) * 10000 + (m.startDate?.month ?? 0) * 100 + (m.startDate?.day ?? 0)
  )
}

export function filterMedia(results: AnilistMedia[], opts: MediaFilterOptions): AnilistMedia[] {
  let out = results
  if (opts.format && opts.format !== 'ALL' && opts.format !== 'ADULT') {
    const f = opts.format.toUpperCase()
    out = out.filter((m) => (m.format ?? '').toUpperCase() === f)
  }
  if (opts.genre_not_in?.length) {
    const excluded = opts.genre_not_in.map((g) => g.toLowerCase())
    out = out.filter((m) => !(m.genres ?? []).some((g) => excluded.includes(g.toLowerCase())))
  }
  if (opts.averageScore_greater != null) {
    out = out.filter((m) => (m.averageScore ?? 0) >= (opts.averageScore_greater as number))
  }
  if (opts.episodes_greater != null) {
    out = out.filter((m) => (m.episodes ?? 0) > (opts.episodes_greater as number))
  }
  if (opts.isAdult === true) out = out.filter((m) => m.isAdult === true)
  if (opts.isAdult === false) out = out.filter((m) => !m.isAdult)
  if (opts.seasonYear && !opts.hasQuery) {
    out = out.filter((m) => m.startDate?.year === opts.seasonYear)
  }
  if (opts.season && opts.season !== 'ALL' && !opts.hasQuery) {
    const months = SEASON_MONTHS[opts.season.toUpperCase()] ?? []
    out = out.filter((m) => m.startDate?.month != null && months.includes(m.startDate.month))
  }
  if (
    opts.sort &&
    !opts.sort.startsWith('POPULARITY_') &&
    !opts.sort.startsWith('TRENDING_') &&
    !opts.sort.startsWith('FAVOURITES_') &&
    !opts.sort.startsWith('START_DATE_') &&
    !opts.sort.startsWith('END_DATE_')
  ) {
    const dir = opts.sort.includes('ASC') ? 1 : -1
    if (opts.sort.startsWith('SCORE_')) {
      const scoreOf = (m: AnilistMedia): number => m.averageScore ?? m.meanScore ?? -1
      out = [...out].sort((a, b) => (scoreOf(a) - scoreOf(b)) * dir)
    } else if (opts.sort.startsWith('EPISODES_')) {
      out = [...out].sort((a, b) => ((a.episodes ?? -1) - (b.episodes ?? -1)) * dir)
    }
  }
  return out
}
