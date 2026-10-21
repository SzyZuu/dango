import { AppCache } from '../utils/cache.utils.js'
import { parseJsonBody } from '../utils/http.utils.js'
import { pickBestMatch } from '../providers/title-matching.js'

const dlsitePosterCache = new AppCache({ ttlSeconds: 3600, maxKeys: 2000 })
const mangadexCoverCache = new AppCache({ ttlSeconds: 3600, maxKeys: 2000 })

export async function getMangadexCover(title: string): Promise<string | null> {
  const key = title.trim().toLowerCase()
  if (!key) return null
  const cached = mangadexCoverCache.get<string | null>(key)
  if (cached !== undefined) return cached
  try {
    const params = new URLSearchParams({
      title: title.trim(),
      limit: '5',
      'includes[]': 'cover_art',
      'order[relevance]': 'desc',
    })
    for (const r of ['safe', 'suggestive', 'erotica', 'pornographic']) {
      params.append('contentRating[]', r)
    }
    const res = await fetch(`https://api.mangadex.org/manga?${params.toString()}`, {
      headers: { 'User-Agent': 'Dango/3.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const data = (await parseJsonBody(res)) as {
      data?: Array<{
        id: string
        attributes?: { title?: Record<string, string>; altTitles?: Record<string, string>[] }
        relationships?: Array<{ type: string; attributes?: { fileName?: string } }>
      }>
    }
    const candidates: Array<{ title: string; cover: string }> = []
    for (const m of data.data || []) {
      const fileName = m.relationships?.find((r) => r.type === 'cover_art')?.attributes?.fileName
      if (!fileName) continue
      const cover = `https://uploads.mangadex.org/covers/${m.id}/${fileName}.256.jpg`
      const main = m.attributes?.title
      const mainTitle = main?.en || main?.['ja-ro'] || Object.values(main || {})[0]
      if (mainTitle) candidates.push({ title: mainTitle, cover })
      for (const alt of m.attributes?.altTitles || []) {
        const t = Object.values(alt)[0]
        if (t) candidates.push({ title: t, cover })
      }
    }
    const match = pickBestMatch(candidates, [title])
    const url = match ? match.item.cover : null
    mangadexCoverCache.set(key, url)
    return url
  } catch {
    return null
  }
}

export async function getDlsitePoster(rjCode: string): Promise<string | null> {
  const key = String(rjCode).trim().toUpperCase()
  if (!/^RJ\d{5,}$/.test(key)) return null
  const cached = dlsitePosterCache.get<string>(key)
  if (cached !== undefined) return cached
  try {
    const res = await fetch(`https://www.dlsite.com/maniax/product/info/ajax?product_id=${key}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const raw = (await parseJsonBody(res)) as unknown
    const data = raw as Record<string, unknown>
    const entryRaw = (data[key] ?? data) as unknown
    const entry = entryRaw as { work_image?: unknown }
    const img: string | undefined =
      typeof entry?.work_image === 'string' ? entry.work_image : undefined
    if (!img) return null
    const url = img.startsWith('//') ? `https:${img}` : img
    dlsitePosterCache.set(key, url)
    return url
  } catch {
    return null
  }
}
