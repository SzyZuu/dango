import { mediaFieldsLight } from './queries.js'
import { mapFallbackResults } from './fallback.js'
import { anilistUnavailable } from './client.js'
import type { AnilistResponse } from './client.js'
import type { Show } from '../../providers/provider.interface.js'
import { buildQueryVariants, pickBestMatch } from '../../providers/title-matching.js'
import { kitsuSearchAnime } from '../kitsu/index.js'
import {
  malSearchMedia,
  malSearchAnime,
  enrichEnglishFromMalDetail,
  toAnilistSearchMedia,
} from '../mal/index.js'
import { malCacheStore } from '../../repositories/mal-cache.repository.js'
import type { AnilistMedia, AnilistSearchOptions } from './types.js'
import { anilistRequest } from './client.js'
import { fromAnilistMedia } from './mappers.js'
import { tryFallback } from './fallback.js'

export async function searchAnilistByTitle(
  title: string,
  type: 'ANIME' | 'MANGA' = 'ANIME'
): Promise<{ id: number; title: { romaji?: string; english?: string; native?: string } } | null> {
  const query = `
    query ($search: String) {
      Page(page: 1, perPage: 5) {
        media(search: $search, type: ${type}) {
          id
          title { romaji english native }
        }
      }
    }
  `

  const normalizedTitle = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const words = normalizedTitle.split(/\s+/).filter((word) => word.length >= 3)
  const searchTerms = [
    title,
    normalizedTitle,
    normalizedTitle.replace(/:/g, ''),
    words.slice(0, 5).join(' '),
    words.slice(0, 4).join(' '),
    words.slice(0, 3).join(' '),
    words.slice(0, 2).join(' ').replace(/:/g, ''),
    normalizedTitle.replace(/\s*\d+(?:st|nd|rd|th)?\s*Season\s*\d*/gi, '').trim(),
  ].filter((t, i, a) => t && a.indexOf(t) === i)
  let media:
    { id: number; title: { romaji?: string; english?: string; native?: string } }[] | undefined
  let anyFailed = false

  for (const searchTerm of searchTerms) {
    const result = await anilistRequest<{
      Page: {
        media?: { id: number; title: { romaji?: string; english?: string; native?: string } }[]
      }
    }>(query, { search: searchTerm })
    if (!result?.data) {
      anyFailed = true
      break
    }
    media = result?.data?.Page?.media
    if (media?.length) break
  }

  if (!media || media.length === 0) {
    if (anyFailed && type === 'ANIME' && anilistUnavailable()) {
      const fb = await kitsuSearchAnime({ query: title, page: 1, perPage: 5 })
      if (fb.length > 0) {
        const best = fb[0]
        return { id: best.id, title: best.title ?? {} }
      }
    }
    return null
  }

  const lowerTitle = title.toLowerCase()
  const exactMatch = media.find(
    (m) =>
      m.title?.romaji?.toLowerCase() === lowerTitle ||
      m.title?.english?.toLowerCase() === lowerTitle ||
      m.title?.native === title
  )

  if (exactMatch) {
    return { id: exactMatch.id, title: exactMatch.title }
  }

  const inputWords = new Set(
    normalizedTitle
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 2)
  )
  let best = media[0]
  let bestScore = 0
  for (const m of media) {
    const text = (m.title?.romaji || m.title?.english || '').toLowerCase()
    const overlap = text.split(/\s+/).filter((w) => inputWords.has(w)).length
    if (overlap > bestScore) {
      bestScore = overlap
      best = m
    }
  }
  return { id: best.id, title: best.title }
}

export async function searchAnilistMangaByTitle(
  title: string
): Promise<{ id: number; title: { romaji?: string; english?: string; native?: string } } | null> {
  return searchAnilistByTitle(title, 'MANGA')
}

function splitList(value?: string | string[]): string[] {
  const arr = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  return [...new Set(arr.map((v) => v.trim()).filter(Boolean))]
}

export async function searchAnilist(options: AnilistSearchOptions = {}): Promise<Show[]> {
  const {
    query,
    page = 1,
    perPage = 14,
    format,
    status,
    season,
    seasonYear,
    countryOfOrigin,
    genre,
    genre_in,
    tag,
    tag_in,
    genre_not_in,
    tag_not_in,
    averageScore_greater,
    episodes_greater,
    isAdult,
    sort,
  } = options

  const searchVars: Record<string, unknown> = {
    page,
    perPage,
  }

  if (query) searchVars.search = query
  if (format && format !== 'ALL') {
    if (format === 'ADULT') {
      searchVars.isAdult = true
    } else {
      searchVars.format = format.toUpperCase()
    }
  }
  if (status) searchVars.status = status
  if (season && season !== 'ALL') searchVars.season = season.toUpperCase()
  if (seasonYear) searchVars.seasonYear = seasonYear
  if (countryOfOrigin && countryOfOrigin !== 'ALL') searchVars.countryOfOrigin = countryOfOrigin
  const genreList = [...splitList(genre), ...(genre_in ?? []).map((g) => g.trim()).filter(Boolean)]
  const uniqueGenres = [...new Set(genreList)]
  if (uniqueGenres.length === 1) searchVars.genre = uniqueGenres[0]
  else if (uniqueGenres.length > 1) searchVars.genre_in = uniqueGenres
  const tagList = [...splitList(tag), ...(tag_in ?? []).map((t) => t.trim()).filter(Boolean)]
  const uniqueTags = [...new Set(tagList)]
  if (uniqueTags.length === 1) searchVars.tag = uniqueTags[0]
  else if (uniqueTags.length > 1) searchVars.tag_in = uniqueTags
  if (genre_not_in && genre_not_in.length > 0) searchVars.genre_not_in = genre_not_in
  if (tag_not_in && tag_not_in.length > 0) searchVars.tag_not_in = tag_not_in
  if (averageScore_greater) searchVars.averageScore_greater = averageScore_greater
  if (episodes_greater) searchVars.episodes_greater = episodes_greater
  if (isAdult !== undefined) searchVars.isAdult = isAdult
  if (sort) searchVars.sort = [sort]

  const queryStr = `
    query ($page: Int, $perPage: Int, $search: String, $format: MediaFormat, $status: MediaStatus, $season: MediaSeason, $seasonYear: Int, $countryOfOrigin: CountryCode, $genre: String, $genre_in: [String], $tag: String, $tag_in: [String], $genre_not_in: [String], $tag_not_in: [String], $averageScore_greater: Int, $episodes_greater: Int, $isAdult: Boolean, $sort: [MediaSort]) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage total }
        media(
          search: $search,
          type: ANIME,
          format: $format,
          status: $status,
          season: $season,
          seasonYear: $seasonYear,
          countryOfOrigin: $countryOfOrigin,
          genre: $genre,
          genre_in: $genre_in,
          tag: $tag,
          tag_in: $tag_in,
          genre_not_in: $genre_not_in,
          tag_not_in: $tag_not_in,
          averageScore_greater: $averageScore_greater,
          episodes_greater: $episodes_greater,
          isAdult: $isAdult,
          sort: $sort
        ) {
          ${mediaFieldsLight()}
        }
      }
    }
  `

  const compactQuery = query?.toLowerCase().replace(/[^a-z0-9]/g, '')
  const searchQueries = query?.trim()
    ? buildQueryVariants(query).filter(
        (term) => term.toLowerCase().replace(/[^a-z0-9]/g, '') === compactQuery
      )
    : ['']
  const mediaById = new Map<number, AnilistMedia>()
  let result: AnilistResponse<{
    Page: {
      pageInfo: { hasNextPage: boolean; total: number }
      media?: AnilistMedia[]
    }
  }> = null

  let searchedVariant = false
  for (const [index, searchQuery] of searchQueries.entries()) {
    result = await anilistRequest<{
      Page: {
        pageInfo: { hasNextPage: boolean; total: number }
        media?: AnilistMedia[]
      }
    }>(queryStr, { ...searchVars, ...(searchQuery ? { search: searchQuery } : {}) })
    if (!result?.data) break
    for (const item of result.data.Page.media ?? []) {
      if (item.id) mediaById.set(item.id, item)
    }
    if (index > 0) searchedVariant = true
    if ((result.data.Page.media?.length ?? 0) >= perPage) break
  }

  if (!result?.data && mediaById.size === 0) {
    if (anilistUnavailable()) {
      const malSearch = async (): Promise<AnilistMedia[]> => {
        const store = malCacheStore()
        let fb = await malSearchMedia(store, {
          query,
          page,
          perPage,
          format: format && format !== 'ALL' && format !== 'ADULT' ? format : undefined,
          status,
          season,
          seasonYear,
          genre,
          genre_in,
          genre_not_in,
          averageScore_greater,
          episodes_greater,
          isAdult: format === 'ADULT' ? true : isAdult,
          sort,
        })
        if (fb.length > 0) {
          try {
            const hentai = await malSearchMedia(
              store,
              {
                query,
                page,
                perPage,
                format: format && format !== 'ALL' && format !== 'ADULT' ? format : undefined,
                status,
                season,
                seasonYear,
                genre,
                genre_in,
                averageScore_greater,
                episodes_greater,
                sort,
                isAdult: true,
              },
              false
            )
            if (hentai.length > 0) {
              const hentaiIds = new Set(hentai.map((m) => m.id))
              fb = fb.filter((m) => !hentaiIds.has(m.id))
            }
          } catch {
            // ignore
          }
        }
        return fb
      }
      const fb = await tryFallback<AnilistMedia>(malSearch, () =>
        kitsuSearchAnime({
          query,
          page,
          perPage,
          format: format && format !== 'ALL' && format !== 'ADULT' ? format : undefined,
          status,
          season,
          seasonYear,
          genre,
          genre_in,
          genre_not_in,
          averageScore_greater,
          episodes_greater,
          isAdult: format === 'ADULT' ? true : isAdult,
          sort,
        })
      )
      try {
        await enrichEnglishFromMalDetail(malCacheStore(), fb)
      } catch {
        // ignore
      }
      let results = mapFallbackResults(fb)
      if (results.length === 0 && query?.trim()) {
        try {
          const mal = await malSearchAnime(malCacheStore(), query, page)
          const media = mal.entries.map((e) => toAnilistSearchMedia(e))
          try {
            await enrichEnglishFromMalDetail(malCacheStore(), media)
          } catch {
            // ignore
          }
          results = media.map((m) => fromAnilistMedia(m))
        } catch {
          // ignore
        }
      }
      return results
    }
    return []
  }

  const media = [...mediaById.values()]
  if (!media || media.length === 0) return []

  if (searchedVariant) {
    media.sort((a, b) => {
      const score = (item: AnilistMedia) =>
        Math.max(
          0,
          ...[item.title?.romaji, item.title?.english, item.title?.native]
            .filter((title): title is string => !!title)
            .map((title) => pickBestMatch([{ title }], [query ?? ''])?.score ?? 0)
        )
      return score(b) - score(a)
    })
  }

  const seen = new Set<number>()
  const results: Show[] = []
  for (const m of media) {
    if (!m.id || seen.has(m.id)) continue
    seen.add(m.id)
    results.push(fromAnilistMedia(m))
  }

  return results.slice(0, perPage)
}
