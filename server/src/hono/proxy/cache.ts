import { AppCache } from '../../utils/cache.utils.js'

export const proxyCache = new AppCache({ ttlSeconds: 30, maxKeys: 500 })
export const imageCache = new AppCache({ ttlSeconds: 86400, maxKeys: 3000 })
