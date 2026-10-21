import type { AnilistMedia } from '../anilist.js'
import { decodeHtml } from '../html.js'
import type { ScrapedDetail, ScrapedSearchEntry } from './types.js'

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
export const MIN_GAP_MS = 1500
export const TIMEOUT_MS = 25000
export const DEFAULT_TTL_SECONDS = 6 * 3600

let lastFetchAt = 0

export async function politeWait(): Promise<void> {
  const wait = MIN_GAP_MS - (Date.now() - lastFetchAt)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastFetchAt = Date.now()
}

export async function fetchHtml(
  url: string
): Promise<{ status: number; html: string; url: string }> {
  await politeWait()
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'follow',
  })
  const html = await res.text()
  return { status: res.status, html, url: res.url }
}

export function firstImage(chunk: string): string | null {
  const m =
    chunk.match(/\bdata-src=["']([^"']+)["']/i) || chunk.match(/\bsrc=["']((?!data:)[^"']+)["']/i)
  if (!m) return null
  const raw = m[1].replace(/&amp;/g, '&')
  const unwrapped = raw.match(/[?&]src=([^&]+)/i)
  let url = raw
  if (unwrapped) {
    try {
      url = decodeURIComponent(unwrapped[1])
    } catch {
      url = unwrapped[1]
    }
  }
  if (/^https:\/\/cdn\.myanimelist\.net\/r\/\d+x\d+\//i.test(url)) {
    url = url.replace(/\/r\/\d+x\d+\//i, '/').split('?')[0]
  }
  return url
}

export function numeric(raw: string | null | undefined): number | null {
  if (!raw) return null
  const cleaned = raw.replace(/,/g, '').trim()
  if (/^(unknown|n\/a|-)$/i.test(cleaned)) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

export function parseSearchCard(chunk: string): ScrapedSearchEntry | null {
  const idMatch = chunk.match(/id="sarea(\d+)"/)
  if (!idMatch) return null
  const malId = Number(idMatch[1])
  const href = chunk.match(
    new RegExp(`href="(https://myanimelist\\.net/anime/${malId}/[^"]*)"`, 'i')
  )?.[1]
  const title = decodeHtml(chunk.match(/<strong>([^<]+)<\/strong>/i)?.[1] ?? '')
  if (!malId || !title) return null
  const synopsisRaw = chunk.match(/class="pt4">([\s\S]*?)<a\s/i)?.[1] ?? null
  const synopsis = synopsisRaw
    ? decodeHtml(synopsisRaw)
        .replace(/\s*read more\.?$/i, '')
        .replace(/\.{3}$/, '')
        .trim() || null
    : null
  const cells = [
    ...chunk.matchAll(/<td class="borderClass ac bgColor\d"[^>]*>\s*([\s\S]*?)\s*<\/td>/gi),
  ].map((m) => decodeHtml(m[1]))
  return {
    id: -malId,
    idMal: malId,
    url: href ?? `https://myanimelist.net/anime/${malId}`,
    title,
    imageUrl: firstImage(chunk),
    synopsis,
    type: cells[0] || null,
    episodes: numeric(cells[1]),
    score: numeric(cells[2]),
  }
}

export function parseSearchResults(html: string): ScrapedSearchEntry[] {
  if (!html.includes('Anime - MyAnimeList.net')) return []
  const out: ScrapedSearchEntry[] = []
  for (const chunk of html.split('<tr>').slice(1)) {
    const entry = parseSearchCard(chunk)
    if (entry && !out.some((e) => e.idMal === entry.idMal)) out.push(entry)
  }
  return out
}

export function metaContent(html: string, property: string): string | null {
  const m = html.match(
    new RegExp(`<meta\\s+property=["']${property}["']\\s+content=["']([^"']*)["']`, 'i')
  )
  return m ? decodeHtml(m[1]) : null
}

export function infoField(html: string, label: string): string | null {
  const m = html.match(
    new RegExp(`<span class="dark_text">${label}:</span>\\s*([^<]*?)(?:<|$)`, 'i')
  )
  return m ? decodeHtml(m[1]).trim() || null : null
}

export function parseDetail(html: string, malId: number): ScrapedDetail | null {
  const title =
    metaContent(html, 'og:title') || decodeHtml(html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1] ?? '')
  if (!title) return null
  if (/^(404\b|not found\b)/i.test(title.trim())) return null
  const rawImage = metaContent(html, 'og:image')
  const imageUrl = rawImage && !/apple-touch-icon|404|error/i.test(rawImage) ? rawImage : null
  const genres = [...html.matchAll(/\/anime\/genre\/\d+\/[^"']*"[^>]*>([^<]+)</gi)]
    .map((m) => decodeHtml(m[1]).trim())
    .filter((g, i, a) => g && a.indexOf(g) === i)
    .slice(0, 10)
  return {
    id: -malId,
    idMal: malId,
    url: metaContent(html, 'og:url') || `https://myanimelist.net/anime/${malId}`,
    title,
    titleEnglish: infoField(html, 'English'),
    titleJapanese: infoField(html, 'Japanese'),
    imageUrl,
    synopsis: metaContent(html, 'og:description'),
    type: infoField(html, 'Type'),
    episodes: numeric(infoField(html, 'Episodes')),
    status: infoField(html, 'Status'),
    score: numeric(infoField(html, 'Score')),
    rating: infoField(html, 'Rating'),
    genres,
  }
}

export function detailToSearchEntry(d: ScrapedDetail): ScrapedSearchEntry {
  return {
    id: d.id,
    idMal: d.idMal,
    url: d.url,
    title: d.title,
    imageUrl: d.imageUrl,
    synopsis: d.synopsis,
    type: d.type,
    episodes: d.episodes,
    score: d.score,
  }
}

export function mapMalStatus(status: string | null): string | undefined {
  if (!status) return undefined
  const s = status.toUpperCase().replace(/\s+/g, '_')
  if (s.includes('FINISHED')) return 'FINISHED'
  if (s.includes('CURRENTLY_AIRING') || s === 'AIRING') return 'RELEASING'
  if (s.includes('NOT_YET_AIRED') || s === 'UPCOMING') return 'NOT_YET_RELEASED'
  return s
}

export function toAnilistSearchMedia(e: ScrapedSearchEntry): AnilistMedia {
  return {
    id: e.id,
    idMal: e.idMal,
    title: { romaji: e.title, english: e.title, native: e.title },
    coverImage: e.imageUrl
      ? { extraLarge: e.imageUrl, large: e.imageUrl, medium: e.imageUrl }
      : undefined,
    description: e.synopsis,
    averageScore: e.score != null ? Math.round(e.score * 10) : null,
    format: e.type?.toUpperCase(),
    episodes: e.episodes,
    siteUrl: e.url,
  }
}

export function toAnilistDetailMedia(e: ScrapedDetail): AnilistMedia {
  const rating = e.rating || ''
  return {
    id: e.id,
    idMal: e.idMal,
    title: {
      romaji: e.title,
      english: e.titleEnglish || e.title,
      native: e.titleJapanese || e.title,
    },
    coverImage: e.imageUrl
      ? { extraLarge: e.imageUrl, large: e.imageUrl, medium: e.imageUrl }
      : undefined,
    description: e.synopsis,
    genres: e.genres.length > 0 ? e.genres : undefined,
    averageScore: e.score != null ? Math.round(e.score * 10) : null,
    format: e.type?.toUpperCase(),
    status: mapMalStatus(e.status),
    episodes: e.episodes,
    isAdult: rating.includes('Rx') || rating.includes('R+'),
    siteUrl: e.url,
  }
}
