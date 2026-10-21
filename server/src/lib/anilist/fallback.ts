import { showFromOfflineEntry } from './mappers.js'
import { hasPoster, withPosterBackfill, type PosterExpectation } from './poster.js'
import { anilistRequest, anilistUnavailable } from './client.js'
import { mediaFields, mediaFieldsLight } from './queries.js'
import type { Show } from '../../providers/provider.interface.js'
import logger from '../../logger.js'
import { kitsuMetaByMalId, kitsuEpisodes } from '../kitsu/index.js'
import { malAnimeDetail, EN_TITLE_CACHE_PREFIX, toAnilistDetailMedia } from '../mal/index.js'
import { malCacheStore } from '../../repositories/mal-cache.repository.js'
import { offlineDb } from '../offline-db/index.js'
import type { AnilistMedia } from './types.js'
import { fromAnilistMedia } from './mappers.js'
import { getCachedAnilist, setCachedAnilist } from './client.js'

export async function tryFallback<T>(
  malFn: () => Promise<T[]>,
  kitsuFn: () => Promise<T[]>
): Promise<T[]> {
  for (const fn of [malFn, kitsuFn]) {
    try {
      const result = await fn()
      if (result && result.length > 0) return result
    } catch {
      // ignore
    }
  }
  return []
}

export function mapFallbackResults(fb: AnilistMedia[]): Show[] {
  const seen = new Set<number>()
  const results: Show[] = []
  for (const m of fb) {
    if (!m.id || seen.has(m.id)) continue
    seen.add(m.id)
    results.push(fromAnilistMedia(m))
  }
  return results
}

export async function getAdultLatest(page: number, size: number): Promise<Show[]> {
  const query = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total hasNextPage }
        media(sort: [START_DATE_DESC, ID_DESC], type: ANIME, isAdult: true) {
          ${mediaFieldsLight()}
        }
      }
    }
  `

  const result = await anilistRequest<{
    Page: {
      pageInfo: { total: number; hasNextPage: boolean }
      media?: AnilistMedia[]
    }
  }>(query, { page, perPage: size })

  if (!result?.data) {
    return []
  }

  const media = result?.data?.Page?.media
  if (!media) return []

  return media.map(fromAnilistMedia)
}

export async function backfillKitsuShowFromMal(show: Show, malId: number): Promise<void> {
  try {
    const d = await malAnimeDetail(malCacheStore(), malId)
    if (d.detail?.imageUrl) show.thumbnail = d.detail.imageUrl
    try {
      malCacheStore().put(
        `${EN_TITLE_CACHE_PREFIX}${malId}`,
        (d.detail?.titleEnglish ?? '').trim(),
        7 * 24 * 3600
      )
    } catch {
      // ignore
    }
    const titleEnglish = d.detail?.titleEnglish?.trim()
    if (
      titleEnglish &&
      (!show.names?.english ||
        show.names.english.trim() === '' ||
        show.names.english === show.names?.romaji)
    ) {
      show.names = { ...show.names, english: titleEnglish }
      show.englishName = titleEnglish
    }
    const titleJapanese = d.detail?.titleJapanese?.trim()
    if (titleJapanese && !show.names?.native) {
      show.names = { ...show.names, native: titleJapanese }
      show.nativeName = titleJapanese
    }
    if ((!show.name || show.name === 'Unknown') && (show.names?.english || show.names?.native)) {
      show.name = show.names.english ?? show.names.native ?? show.name
    }
  } catch {
    // ignore
  }
}

export async function getShowMetaByMalId(malId: number): Promise<Show | null> {
  const absMal = Math.abs(malId)
  if (!absMal) return null
  const cacheKey = `meta:v2:-${absMal}`
  const cached = getCachedAnilist<Show>(cacheKey) ?? getCachedAnilist<Show>(`meta:-${absMal}`)
  const expected: PosterExpectation = { malId: absMal, titles: [] }
  if (cached && cached.anilistId != null && cached.anilistId > 0 && hasPoster(cached)) {
    setCachedAnilist(cacheKey, cached)
    return cached
  }
  const anilistUp = !anilistUnavailable()
  if (cached && !anilistUp && hasPoster(cached)) {
    setCachedAnilist(cacheKey, cached)
    return cached
  }

  if (anilistUp) {
    try {
      const byMal = await anilistRequest<{ Media?: AnilistMedia | null }>(
        `query ($id: Int) { Media(idMal: $id, type: ANIME) { ${mediaFields()} } }`,
        { id: absMal }
      )
      if (byMal?.data?.Media) {
        const show = fromAnilistMedia(byMal.data.Media)
        return withPosterBackfill(show, cacheKey, expected)
      }
    } catch {
      // ignore
    }
  }

  const offline = anilistUp ? null : offlineDb.getByMalId(absMal)
  const offlineShow = offline ? showFromOfflineEntry(offline) : null
  if (offlineShow && hasPoster(offlineShow)) {
    setCachedAnilist(cacheKey, offlineShow)
    return offlineShow
  }

  try {
    const fb = await kitsuMetaByMalId(absMal)
    if (fb) {
      const show = fromAnilistMedia(fb)
      await backfillKitsuShowFromMal(show, absMal)
      if (hasPoster(show)) {
        setCachedAnilist(cacheKey, show)
        return show
      }
      return withPosterBackfill(show, cacheKey, expected)
    }
  } catch {
    // ignore
  }

  try {
    const d = await malAnimeDetail(malCacheStore(), absMal)
    if (d.detail) {
      const show = fromAnilistMedia(toAnilistDetailMedia(d.detail))
      return withPosterBackfill(show, cacheKey, expected)
    }
  } catch {
    // ignore
  }

  if (cached && !hasPoster(cached)) {
    return withPosterBackfill(cached, cacheKey, expected)
  }

  if (offlineShow) {
    setCachedAnilist(cacheKey, offlineShow)
    return offlineShow
  }

  logger.warn({ malId: absMal }, 'MAL id unresolvable on all metadata providers')
  return null
}

export async function getEpisodesByMalId(malId: number): Promise<string[]> {
  const cacheKey = `eps:-${malId}`
  const cached = getCachedAnilist<string[]>(cacheKey)
  if (cached) return cached

  try {
    const episodes = await kitsuEpisodes(0, malId)
    if (episodes.length > 0) {
      setCachedAnilist(cacheKey, episodes)
      return episodes
    }
  } catch {
    // ignore
  }

  try {
    const d = await malAnimeDetail(malCacheStore(), malId)
    const total = d.detail?.episodes
    if (total && total > 0 && total <= 2000) {
      const episodes = Array.from({ length: total }, (_, i) => (i + 1).toString())
      setCachedAnilist(cacheKey, episodes)
      return episodes
    }
  } catch {
    // ignore
  }

  return []
}
