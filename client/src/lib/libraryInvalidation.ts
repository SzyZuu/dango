import type { QueryClient } from '@tanstack/react-query'
import { qk } from './queryKeys'

export type LibraryKind = 'tv' | 'manga' | 'asmr'

const LIBRARY_KEYS: Record<LibraryKind, { library: string; continue: string; progress: string }> = {
  tv: { library: qk.tvLibrary, continue: qk.tvContinueWatching, progress: qk.tvProgress },
  manga: {
    library: qk.mangaLibrary,
    continue: qk.mangaContinueReading,
    progress: qk.mangaProgress,
  },
  asmr: {
    library: qk.asmrLibrary,
    continue: qk.asmrContinueListening,
    progress: qk.asmrProgress,
  },
}

// the library hooks of the 3 kinds invalidate the same key families
export function invalidateLibrary(
  queryClient: QueryClient,
  kind: LibraryKind,
  withProgress = false
) {
  const keys = LIBRARY_KEYS[kind]
  if (withProgress) queryClient.invalidateQueries({ queryKey: [keys.progress] })
  queryClient.invalidateQueries({ queryKey: [keys.library] })
  queryClient.invalidateQueries({ queryKey: [keys.continue] })
}
