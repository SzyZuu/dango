import { useCallback, useEffect, useRef, useState } from 'react'
import { isProgressCompleted } from '../lib/playbackCompletion'
import type { QueueItem } from './useAnimeData'

interface UseNextEpisodePromptOptions {
  videoRef: { current: HTMLVideoElement | null }
  queue: QueueItem[]
  showId: string | undefined
  showMetaId?: string
  currentEpisode?: string | null
  selectedSource?: { type?: string } | null
  hasNextEpisode: boolean
  nextEpisode: string | null
  prefetchEpisodeSources: (episodeNumber: string, targetShowId?: string) => void
  setReachedEpisodeEnd: (reached: boolean) => void
  matchesQueueItem: (item: QueueItem, id: string | undefined, metaId: string | undefined) => boolean
}

// the prompt at the end of an episode and the prefetch of the next one
export function useNextEpisodePrompt({
  videoRef,
  queue,
  showId,
  showMetaId,
  currentEpisode,
  selectedSource,
  hasNextEpisode,
  nextEpisode,
  prefetchEpisodeSources,
  setReachedEpisodeEnd,
  matchesQueueItem,
}: UseNextEpisodePromptOptions) {
  const [showNextEpisodePrompt, setShowNextEpisodePrompt] = useState(false)
  const prefetchNextEpisodeRef = useRef(prefetchEpisodeSources)
  prefetchNextEpisodeRef.current = prefetchEpisodeSources
  const prefetchedForRef = useRef<string>('')

  useEffect(() => {
    setShowNextEpisodePrompt(false)
    setReachedEpisodeEnd(false)
  }, [currentEpisode, setReachedEpisodeEnd])

  const handleThresholds = useCallback(() => {
    const videoElement = videoRef.current
    if (!videoElement || selectedSource?.type === 'iframe') return

    const duration = videoElement.duration
    const currentTime = videoElement.currentTime

    if (!duration || Number.isNaN(duration)) {
      setShowNextEpisodePrompt(false)
      setReachedEpisodeEnd(false)
      return
    }

    if (duration - currentTime <= 60) {
      const activeQueueIndex = queue.findIndex(
        (item) =>
          matchesQueueItem(item, showId, showMetaId) && item.episodeNumber === currentEpisode
      )
      const nextQueueItem =
        queue.length > 0
          ? activeQueueIndex >= 0
            ? queue[activeQueueIndex + 1] || null
            : queue[0]
          : null

      const prefetchKey = nextQueueItem
        ? `${nextQueueItem.showId}:${nextQueueItem.episodeNumber}`
        : hasNextEpisode
          ? `${showId}:${nextEpisode}`
          : ''

      if (prefetchKey && prefetchedForRef.current !== prefetchKey) {
        prefetchedForRef.current = prefetchKey
        if (nextQueueItem) {
          prefetchNextEpisodeRef.current(nextQueueItem.episodeNumber, nextQueueItem.showId)
        } else {
          prefetchNextEpisodeRef.current(nextEpisode ?? '')
        }
      }
    }

    setShowNextEpisodePrompt(hasNextEpisode && isProgressCompleted(currentTime, duration))
    setReachedEpisodeEnd(currentTime >= Math.max(duration * 0.98, duration - 10))
  }, [
    videoRef,
    selectedSource,
    queue,
    showId,
    showMetaId,
    currentEpisode,
    hasNextEpisode,
    nextEpisode,
    setReachedEpisodeEnd,
    matchesQueueItem,
  ])

  return { showNextEpisodePrompt, handleThresholds }
}
