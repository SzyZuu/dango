import type { Hono } from 'hono'
import type { RemoteProxyRule } from '../providers/remote-types.js'
import { proxyEmbed } from './proxy/embed.js'
import { proxyImage } from './proxy/image.js'
import { proxyResolve } from './proxy/resolve.js'
import { proxyStream } from './proxy/stream.js'
import { proxySubtitles } from './proxy/subtitles.js'

export function registerProxy(app: Hono, getProxyRules: () => RemoteProxyRule[]) {
  app.get('/api/proxy', (c) => proxyStream(c, getProxyRules))
  app.get('/api/embed-proxy', (c) => proxyEmbed(c, getProxyRules))
  app.get('/api/subtitle-proxy', (c) => proxySubtitles(c, getProxyRules))
  app.get('/api/image-proxy', (c) => proxyImage(c, getProxyRules))
  app.get('/api/resolve', (c) => proxyResolve(c))
}
