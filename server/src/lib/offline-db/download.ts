import crypto from 'crypto'
import { decodeMaybeGzip } from '../../utils/http.utils.js'
import logger from '../../logger.js'
import { CANONICAL_GENRES } from '../media-vocab.js'
import type { OfflineEntry } from './types.js'

const log = logger.child({ module: 'OfflineDb' })

// the repo moved to the manami-project org and the dataset lives in the releases only
const OFFLINE_DB_URLS = [
  'https://github.com/manami-project/anime-offline-database/releases/latest/download/anime-offline-database-minified.json',
  'https://github.com/manami-project/anime-offline-database/releases/download/2026-27/anime-offline-database-minified.json',
]

const FETCH_IDLE_TIMEOUT_MS = 60000
const FETCH_OVERALL_TIMEOUT_MS = 30 * 60 * 1000
const MAX_BODY_BYTES = 100 * 1024 * 1024

const canonicalGenreMap = new Map(CANONICAL_GENRES.map((g) => [g.toLowerCase(), g]))

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController()
  const overall = setTimeout(() => controller.abort(), FETCH_OVERALL_TIMEOUT_MS)
  let idle: ReturnType<typeof setTimeout> | undefined
  const touchIdle = (): void => {
    if (idle) clearTimeout(idle)
    idle = setTimeout(() => controller.abort(), FETCH_IDLE_TIMEOUT_MS)
  }
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Dango-Media-Client/1.0', Accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const length = res.headers.get('content-length')
    if (length && Number(length) > MAX_BODY_BYTES) throw new Error('Response too large')
    if (!res.body) throw new Error('Empty response body')
    touchIdle()
    const chunks: Buffer[] = []
    let total = 0
    const reader = res.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        touchIdle()
        total += value.byteLength
        if (total > MAX_BODY_BYTES) throw new Error('Response too large')
        chunks.push(Buffer.from(value))
      }
    } finally {
      reader.releaseLock()
    }
    const text = decodeMaybeGzip(Buffer.concat(chunks)).toString('utf8')
    if (text.length > MAX_BODY_BYTES) throw new Error('Response too large')
    return text
  } finally {
    if (idle) clearTimeout(idle)
    clearTimeout(overall)
  }
}

function parseEntries(data: unknown[]): OfflineEntry[] {
  const anilistRegex = /anilist\.co\/anime\/(\d+)/i
  const malRegex = /myanimelist\.net\/anime\/(\d+)/i
  const parsedEntries: OfflineEntry[] = []

  for (const item of data) {
    const rec = item as {
      sources?: unknown
      title?: unknown
      thumbnail?: unknown
      picture?: unknown
      type?: unknown
      tags?: unknown
    }
    if (!Array.isArray(rec.sources)) continue
    let anilistId: number | null = null
    let malId: number | null = null
    for (const src of rec.sources) {
      if (typeof src !== 'string') continue
      const anilistMatch = src.match(anilistRegex)
      if (anilistMatch) anilistId = parseInt(anilistMatch[1], 10)
      const malMatch = src.match(malRegex)
      if (malMatch) malId = parseInt(malMatch[1], 10)
    }
    if (!anilistId || !malId) continue

    let thumbnail =
      typeof rec.thumbnail === 'string'
        ? rec.thumbnail
        : typeof rec.picture === 'string'
          ? rec.picture
          : ''
    if (thumbnail.includes('cdn.myanimelist.net/images/anime/')) {
      thumbnail = thumbnail.replace(/t\.(jpe?g|png|webp)$/i, 'l.$1')
    }

    let genres: string | undefined
    if (Array.isArray(rec.tags)) {
      const matched = new Set<string>()
      for (const tag of rec.tags) {
        if (typeof tag !== 'string') continue
        const canonical = canonicalGenreMap.get(tag.trim().toLowerCase())
        if (canonical) matched.add(canonical)
      }
      if (matched.size > 0) genres = JSON.stringify([...matched])
    }

    parsedEntries.push({
      anilistId,
      malId,
      title: typeof rec.title === 'string' ? rec.title : '',
      thumbnail: thumbnail || undefined,
      type: typeof rec.type === 'string' ? rec.type : undefined,
      genres,
    })
  }

  return parsedEntries
}

export interface OfflineDbDownload {
  entries: OfflineEntry[]
  sha256: string
  sourceUrl: string
}

export async function downloadOfflineDb(): Promise<OfflineDbDownload> {
  let text: string | null = null
  let sourceUrl: string | null = null
  let lastErr: Error | null = null
  for (const url of OFFLINE_DB_URLS) {
    try {
      log.info(`Fetching anime-offline-database from ${url}...`)
      text = await fetchText(url)
      const parsed = JSON.parse(text)
      if (parsed && Array.isArray(parsed.data)) {
        sourceUrl = url
        break
      }
      text = null
    } catch (err) {
      lastErr = err as Error
      log.warn(`Failed downloading from ${url}: ${(err as Error).message}`)
    }
  }
  if (!text) throw lastErr || new Error('Could not download anime-offline-database from any source')

  const sha256 = crypto.createHash('sha256').update(text).digest('hex')
  const data = (JSON.parse(text) as { data: unknown[] }).data
  return { entries: parseEntries(data), sha256, sourceUrl: sourceUrl as string }
}
