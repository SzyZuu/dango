import type { AnilistMedia } from '../anilist/index.js'
import { includedMap, type KitsuEntry } from './client.js'

export const KITSU_STATUS_MAP: Record<string, string> = {
  current: 'RELEASING',
  finished: 'FINISHED',
  upcoming: 'NOT_YET_RELEASED',
  unreleased: 'NOT_YET_RELEASED',
  tba: 'NOT_YET_RELEASED',
}

export const SUBTYPE_MAP: Record<string, string> = {
  tv: 'TV',
  ova: 'OVA',
  ona: 'ONA',
  movie: 'MOVIE',
  special: 'SPECIAL',
  music: 'MUSIC',
}

export const SEASON_BY_MONTH = [
  'WINTER',
  'WINTER',
  'SPRING',
  'SPRING',
  'SPRING',
  'SUMMER',
  'SUMMER',
  'SUMMER',
  'FALL',
  'FALL',
  'FALL',
  'WINTER',
]

export function parseKitsuDate(
  s: unknown
): { year?: number; month?: number; day?: number } | undefined {
  if (typeof s !== 'string' || !s) return undefined
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return undefined
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
}

export function statusToAnilist(status: string | undefined): string | undefined {
  if (!status) return undefined
  return KITSU_STATUS_MAP[status.toLowerCase()] ?? status.toUpperCase()
}

export function formatToAnilist(subtype: string | undefined): string | undefined {
  if (!subtype) return undefined
  return SUBTYPE_MAP[subtype.toLowerCase()] ?? subtype.toUpperCase()
}

export function anilistSortToKitsu(sort: string | undefined): string {
  switch (sort) {
    case 'SCORE_DESC':
      return '-averageRating'
    case 'FAVOURITES_DESC':
      return '-favoritesCount'
    case 'START_DATE_DESC':
      return '-startDate'
    case 'END_DATE_DESC':
      return '-endDate'
    case 'EPISODES_DESC':
      return '-episodeCount'
    case 'ID_DESC':
      return '-id'
    case 'UPDATED_AT_DESC':
      return '-updatedAt'
    default:
      return '-userCount'
  }
}

export function statusToKitsuFilter(status: string | undefined): string | undefined {
  if (!status) return undefined
  const s = status.toUpperCase()
  if (s === 'RELEASING' || s === 'ONGOING') return 'current'
  if (s === 'FINISHED') return 'finished'
  if (s === 'NOT_YET_RELEASED' || s === 'UPCOMING' || s === 'HIATUS') return 'upcoming'
  return undefined
}

export function seasonToKitsu(season: string | undefined): string | undefined {
  if (!season) return undefined
  return season.toLowerCase()
}

const CATEGORY_ALIASES: Record<string, string> = {
  'Sci-Fi': 'Science Fiction',
  'Sci Fi': 'Science Fiction',
  Shounen: 'Shounen',
}

export function normalizeCategory(cat: string): string {
  const c = cat.trim()
  const alias = Object.entries(CATEGORY_ALIASES).find(([k]) => k.toLowerCase() === c.toLowerCase())
  return alias ? alias[1] : c
}

export function dedupeKitsuMedia(list: AnilistMedia[]): AnilistMedia[] {
  const seen = new Set<number>()
  const out: AnilistMedia[] = []
  for (const m of list) {
    const key = m.id > 0 ? m.id : (m.idMal ?? m.id)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(m)
  }
  return out
}

export function normalizeKitsuEntry(
  entry: KitsuEntry,
  included: KitsuEntry[],
  knownIds?: { anilistId?: number | null; malId?: number | null }
): AnilistMedia | null {
  const a = entry.attributes
  const mappings = includedMap(entry, included, 'mappings')
  const anilistMapping = mappings.find((m) => m.attributes?.externalSite === 'anilist/anime')
  const malMapping = mappings.find((m) => m.attributes?.externalSite === 'myanimelist/anime')

  const anilistId = anilistMapping
    ? Number(anilistMapping.attributes.externalId)
    : (knownIds?.anilistId ?? null)
  const malId = malMapping ? Number(malMapping.attributes.externalId) : (knownIds?.malId ?? null)
  if (!anilistId && !malId) return null

  const id = anilistId ?? -Math.abs(malId as number)
  const title: { romaji?: string; english?: string; native?: string } = {}
  const titles = (a.titles as Record<string, string> | undefined) ?? {}
  title.romaji =
    titles.en_jp || titles.en || (entry.attributes.canonicalTitle as string | undefined)
  title.english = titles.en || titles.en_us || title.romaji
  title.native = titles.ja_jp || titles.ja || title.romaji

  const startDate = parseKitsuDate(a.startDate)
  const endDate = parseKitsuDate(a.endDate)

  const poster = (a.posterImage as Record<string, string> | undefined) ?? {}
  const cover = (a.coverImage as Record<string, string> | undefined) ?? {}
  const posterUrl =
    poster.large || poster.original || poster.medium || poster.small || poster.tiny || null
  const coverUrl = cover.large || cover.original

  const genres = includedMap(entry, included, 'categories')
    .map((c) => c.attributes?.title as string | undefined)
    .filter(Boolean)
    .map((g) => normalizeCategory(g as string))

  const nextAiringAt =
    a.nextRelease != null ? Math.floor(new Date(a.nextRelease as string).getTime() / 1000) : null

  return {
    id,
    idMal: malId,
    title,
    bannerImage: coverUrl || null,
    coverImage: posterUrl
      ? { extraLarge: posterUrl, large: posterUrl, medium: posterUrl }
      : undefined,
    description:
      (a.synopsis as string | undefined) || (a.description as string | undefined) || null,
    genres: genres.length > 0 ? genres : undefined,
    averageScore: a.averageRating != null ? Math.round(Number(a.averageRating)) : null,
    format: formatToAnilist(a.subtype as string | undefined),
    status: statusToAnilist(a.status as string | undefined),
    episodes: (a.episodeCount as number | null | undefined) ?? null,
    duration: (a.episodeLength as number | null | undefined) ?? null,
    season: startDate?.month ? SEASON_BY_MONTH[startDate.month - 1] : undefined,
    seasonYear: startDate?.year ?? undefined,
    startDate,
    endDate,
    isAdult: !!a.nsfw,
    synonyms: (a.abbreviatedTitles as string[] | undefined) ?? undefined,
    popularity: (a.userCount as number | undefined) ?? undefined,
    favourites: (a.favoritesCount as number | undefined) ?? undefined,
    nextAiringEpisode:
      nextAiringAt != null
        ? {
            episode: 0,
            timeUntilAiring: nextAiringAt - Math.floor(Date.now() / 1000),
            airingAt: nextAiringAt,
          }
        : null,
  }
}
