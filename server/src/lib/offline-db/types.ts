export interface OfflineEntry {
  anilistId: number
  malId: number
  title: string
  thumbnail?: string
  type?: string
  genres?: string
}

export interface OfflineDbInfo {
  totalMapped: number
  totalMalMapped: number
  isInitialized: boolean
  isRefreshing: boolean
  autoUpdateEnabled: boolean
  lastCheckedAt: string | null
  lastUpdatedAt: string | null
  lastStatus: 'idle' | 'updating' | 'success' | 'failed'
  lastMessage: string | null
  sourceUrl: string | null
  releaseTag: string | null
  contentSha256: string | null
  entryCount: number
  schemaVersion: number
  nextDueAt: string
}
