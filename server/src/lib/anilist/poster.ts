import type { Show } from '../../providers/provider.interface.js'
import { kitsuSearchAnime } from '../kitsu/index.js'
import { malSearchAnime } from '../mal/index.js'
import { malCacheStore } from '../../repositories/mal-cache.repository.js'
import { offlineDb } from '../offline-db/index.js'
import type { AnilistMedia } from './types.js'
import { setCachedAnilist } from './client.js'

export function parseMalId(id: string | number): number | null {
  if (typeof id === 'number') return id < 0 ? Math.abs(id) : null
  const prefixed = /^mal-(\d+)$/i.exec(id.trim())
  if (prefixed) return parseInt(prefixed[1], 10)
  if (/^-\d+$/.test(id.trim())) return Math.abs(parseInt(id, 10))
  return null
}

export function hasPoster(show: Show | null | undefined): boolean {
  return !!show?.thumbnail && show.thumbnail.trim() !== ''
}

export function posterFromMedia(m: AnilistMedia | null | undefined): string | null {
  const url =
    m?.coverImage?.extraLarge ||
    m?.coverImage?.large ||
    m?.coverImage?.medium ||
    (m?.coverImage as { small?: string; tiny?: string; original?: string } | undefined)?.original ||
    (m?.coverImage as { small?: string; tiny?: string } | undefined)?.small ||
    (m?.coverImage as { tiny?: string } | undefined)?.tiny
  return url && url.trim() !== '' ? url : null
}

export interface PosterExpectation {
  anilistId?: number
  malId?: number
  titles: string[]
}

export function titleWords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 2)
  )
}

export function titleSimilarity(a: string, b: string): number {
  if (!a.trim() || !b.trim()) return 0
  const an = a.trim().toLowerCase()
  const bn = b.trim().toLowerCase()
  if (an === bn || an.includes(bn) || bn.includes(an)) return 1
  const wa = titleWords(a)
  const wb = titleWords(b)
  if (wa.size === 0 || wb.size === 0) return 0
  const overlap = [...wa].filter((w) => wb.has(w)).length
  return overlap / Math.min(wa.size, wb.size)
}

export function titlesMatchAny(candidate: string | null | undefined, expected: string[]): boolean {
  if (!candidate) return false
  return expected.some((t) => titleSimilarity(candidate, t) >= 0.6)
}

export async function findPosterByTitle(
  title: string | null | undefined,
  expected?: PosterExpectation
): Promise<string | null> {
  const clean = title?.trim()
  if (!clean) return null
  const expectedTitles = (expected?.titles ?? []).filter((t) => t.trim() !== '')
  try {
    const { entries } = await malSearchAnime(malCacheStore(), clean, 1)
    for (const e of entries) {
      if (!e.imageUrl || e.imageUrl.trim() === '') continue
      if (expected?.malId && e.idMal === expected.malId) return e.imageUrl
      if (expected && titlesMatchAny(e.title, expectedTitles)) return e.imageUrl
      if (!expected) return e.imageUrl
    }
  } catch {
    // ignore
  }
  try {
    const kitsu = await kitsuSearchAnime({ query: clean, page: 1, perPage: 5 })
    for (const m of kitsu) {
      const url = posterFromMedia(m)
      if (!url) continue
      if (expected?.anilistId && m.id === expected.anilistId) return url
      if (expected?.malId && m.idMal === expected.malId) return url
    }
  } catch {
    // ignore
  }
  return null
}

export async function withPosterBackfill(
  show: Show | null,
  cacheKey: string,
  expected?: PosterExpectation
): Promise<Show | null> {
  if (!show) return null
  if (hasPoster(show)) {
    setCachedAnilist(cacheKey, show)
    return show
  }
  if (expected && (expected.anilistId || expected.malId)) {
    const entry =
      (expected.anilistId ? offlineDb.getByAnilistId(expected.anilistId) : null) ??
      (expected.malId ? offlineDb.getByMalId(expected.malId) : null)
    const thumb = entry?.thumbnail
    if (thumb && thumb.trim() !== '') {
      show.thumbnail = thumb
      setCachedAnilist(cacheKey, show)
      return show
    }
  }
  const candidates = [show.names?.english, show.englishName, show.name, show.names?.romaji]
    .filter((t): t is string => !!t && t.trim().length >= 4)
    .filter((t, i, a) => a.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i)
  const exp: PosterExpectation = expected ?? { titles: [] }
  if (exp.titles.length === 0) exp.titles = [...candidates]
  if (show.names?.native) exp.titles.push(show.names.native)
  const seen = new Set<string>()
  for (const title of candidates) {
    const key = title.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    try {
      const poster = await findPosterByTitle(title, exp)
      if (poster) {
        show.thumbnail = poster
        setCachedAnilist(cacheKey, show)
        return show
      }
    } catch {
      // ignore
    }
  }
  return show
}
