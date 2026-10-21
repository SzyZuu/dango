import type { Context } from 'hono'
import { isSafeExternalUrl } from '../../utils/security.utils.js'
import { fetchWithRetry } from '../../utils/http.utils.js'

export async function proxyResolve(c: Context) {
  const targetUrl = c.req.query('url')
  if (!targetUrl || typeof targetUrl !== 'string') {
    return c.json({ error: 'URL required' }, 400)
  }

  const safeCheck = isSafeExternalUrl(targetUrl)
  if (!safeCheck.safe) {
    return c.json({ error: safeCheck.error || 'Invalid URL' }, 400)
  }

  try {
    const response = await fetchWithRetry(
      targetUrl,
      {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
      },
      { retries: 2, timeoutMs: 15000 }
    )
    void response.body?.cancel().catch(() => {})

    return c.json({
      finalUrl: response.url,
      status: response.status,
    })
  } catch (e) {
    const err = e as { message?: string }
    return c.json({ error: err.message || 'Resolve failed' }, 500)
  }
}
