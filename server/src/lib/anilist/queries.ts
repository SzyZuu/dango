import { getCachedAiredEpisodes, isAnilistRateLimited, setCachedAiredEpisodes } from './client.js'
import logger from '../../logger.js'
import { getAiredEpisodesFromAniScheduleFeed } from '../anischedule.js'
import { CANONICAL_GENRES } from '../media-vocab.js'
import type { AnilistMedia, AnilistSort, GenreTagLists, MangaMeta } from './types.js'
import { anilistRequest } from './client.js'

const STATIC_GENRES = CANONICAL_GENRES

let genreTagCache: { genres: string[]; tags: string[]; at: number } | null = null
const GENRE_TAG_TTL_MS = 24 * 3600 * 1000

interface MangaMetaMedia {
  id: number
  title?: { romaji?: string; english?: string; native?: string }
  coverImage?: { large?: string }
}

const MANGA_META_FRAGMENT = `id title { romaji english native } coverImage { large }`

export function mediaFields(): string {
  return `
    id
    idMal
    title { romaji english native }
    bannerImage
    coverImage { extraLarge large medium color }
    description
    genres
    averageScore
    meanScore
    format
    status
    episodes
    duration
    season
    seasonYear
    startDate { year month day }
    endDate { year month day }
    countryOfOrigin
    isAdult
    synonyms
    trending
    popularity
    favourites
    tags { id name rank isMediaSpoiler }
    studios(isMain: true) { nodes { id name } }
    nextAiringEpisode { episode timeUntilAiring airingAt }
    trailer { id site thumbnail }
    rankings { id rank type format allTime context }
    siteUrl
  `
}

export function mediaFieldsLight(): string {
  return `
    id
    title { romaji english native }
    coverImage { extraLarge large }
    status
    averageScore
    episodes
    seasonYear
    season
    genres
    isAdult
    format
    nextAiringEpisode { episode }
  `
}

export async function getGenreTagLists(): Promise<GenreTagLists> {
  if (genreTagCache && Date.now() - genreTagCache.at < GENRE_TAG_TTL_MS) {
    return { genres: genreTagCache.genres, tags: genreTagCache.tags }
  }
  try {
    const result = await anilistRequest<{
      GenreCollection?: string[]
      MediaTagCollection?: { name: string; isAdult?: boolean }[]
    }>(`query { GenreCollection MediaTagCollection { name isAdult } }`)
    const genres = result?.data?.GenreCollection?.filter((g) => typeof g === 'string')
    const tags = (result?.data?.MediaTagCollection ?? [])
      .filter((t) => t && !t.isAdult && typeof t.name === 'string')
      .map((t) => t.name)
    if (genres && genres.length > 0) {
      genreTagCache = { genres, tags, at: Date.now() }
      return { genres, tags }
    }
  } catch {
    // ignore
  }
  return { genres: STATIC_GENRES, tags: [] }
}

export async function fetchAnilistMedia(
  page: number = 1,
  perPage: number = 20,
  sort: AnilistSort = 'TRENDING_DESC',
  status?: string
): Promise<AnilistMedia[] | null> {
  const statusFilter = status ? `status: ${status},` : ''
  const query = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(sort: ${sort}, type: ANIME, isAdult: false, ${statusFilter}) {
          ${mediaFields()}
        }
      }
    }
  `

  const result = await anilistRequest<{ Page: { media?: AnilistMedia[] } }>(query, {
    page,
    perPage,
  })
  if (!result?.data) return null
  return result?.data?.Page?.media ?? []
}

export async function getMangaMetaById(id: number): Promise<MangaMeta | null> {
  if (!id) return null
  try {
    const result = await anilistRequest<{ Media?: MangaMetaMedia | null }>(
      `query ($id: Int) { Media(id: $id, type: MANGA) { ${MANGA_META_FRAGMENT} } }`,
      { id }
    )
    const m = result?.data?.Media
    if (!m) return null
    return { id: m.id, title: m.title ?? {}, cover: m.coverImage?.large }
  } catch {
    return null
  }
}

export async function getMangaMetaByMalId(malId: number): Promise<MangaMeta | null> {
  const absMal = Math.abs(malId)
  if (!absMal) return null
  try {
    const result = await anilistRequest<{ Media?: MangaMetaMedia | null }>(
      `query ($id: Int) { Media(idMal: $id, type: MANGA) { ${MANGA_META_FRAGMENT} } }`,
      { id: absMal }
    )
    const m = result?.data?.Media
    if (!m) return null
    return { id: m.id, title: m.title ?? {}, cover: m.coverImage?.large }
  } catch {
    return null
  }
}

export async function getAiredEpisodesForShows(
  ids: number[],
  startDate: Date,
  endDate: Date
): Promise<{ mediaId: number; episode: number; airingAt: number }[]> {
  const dayStart = Math.floor(startDate.getTime() / 1000)
  const dayEnd = Math.floor(endDate.getTime() / 1000)

  const cacheKey = `aired:${dayStart}:${dayEnd}:${Array.from(ids)
    .sort((a, b) => a - b)
    .join(',')}`
  const cached = getCachedAiredEpisodes(cacheKey)
  if (cached) return cached

  try {
    const results = await getAiredEpisodesFromAniScheduleFeed(ids, dayStart, dayEnd)
    setCachedAiredEpisodes(cacheKey, results)
    return results
  } catch (e) {
    logger.warn(
      { err: e },
      'AniSchedule episode feed failed, falling back to AniList aired episodes'
    )
  }

  if (isAnilistRateLimited()) {
    return []
  }

  const now = Math.floor(Date.now() / 1000)
  const results: { mediaId: number; episode: number; airingAt: number }[] = []
  const seen = new Set<string>()
  const BATCH = 5

  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH)
    const aliases = batch
      .map(
        (_id, idx) =>
          `a${idx}: Media(id: $id${idx}, type: ANIME) { id airingSchedule(perPage: 100) { nodes { episode airingAt } } }`
      )
      .join('\n')

    const variables: Record<string, unknown> = {}
    batch.forEach((id, idx) => {
      variables[`id${idx}`] = id
    })

    const result = await anilistRequest<
      Record<
        string,
        { id: number; airingSchedule?: { nodes?: { episode: number; airingAt: number }[] } }
      >
    >(`query (${batch.map((_, idx) => `$id${idx}: Int`).join(', ')}) { ${aliases} }`, variables)

    for (let j = 0; j < batch.length; j++) {
      const alias = `a${j}`
      const media = result?.data?.[alias]
      if (!media?.airingSchedule?.nodes) continue
      for (const node of media.airingSchedule.nodes) {
        if (node.airingAt >= dayStart && node.airingAt <= dayEnd && node.airingAt <= now) {
          const key = `${media.id}:${node.episode}`
          if (!seen.has(key)) {
            seen.add(key)
            results.push({ mediaId: media.id, episode: node.episode, airingAt: node.airingAt })
          }
        }
      }
    }
  }

  setCachedAiredEpisodes(cacheKey, results)
  return results
}
