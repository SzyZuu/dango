export interface JasmrApi {
  browse(o: { query?: string; page?: number; sort?: string; rating?: string }): Promise<{
    shows: unknown[]
    hasNext: boolean
  }>
  getEpisodes(showId: string): Promise<{ description?: string } | null>
  getStreamUrls(
    showId: string,
    episode: string
  ): Promise<{ links: { resolutionStr: string; link: string; hls: boolean }[] }[] | null>
  getImages(showId: string): Promise<string[]>
  getChapters(showId: string): Promise<{ time: number; label: string }[]>
}

export function isJasmrApi(mod: unknown): mod is JasmrApi {
  if (!mod || typeof mod !== 'object') return false
  const m = mod as Record<string, unknown>
  return (
    typeof m.browse === 'function' &&
    typeof m.getEpisodes === 'function' &&
    typeof m.getStreamUrls === 'function' &&
    typeof m.getImages === 'function' &&
    typeof m.getChapters === 'function'
  )
}
