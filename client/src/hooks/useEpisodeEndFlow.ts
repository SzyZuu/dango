import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { isShowFinale } from '../lib/playbackCompletion'
import type { Action } from '../reducers/playerReducer'
import type { QueueItem } from '../hooks/useAnimeData'

export const matchesQueueItem = (
  item: QueueItem,
  id: string | undefined,
  metaId: string | undefined
) => item.showId === id || (!!metaId && item.showId === metaId)

interface UseEpisodeEndFlowOptions {
  videoRef: { current: HTMLVideoElement | null }
  testClipActive: boolean
  selectedSourceType?: string
  onEnded: () => void
  queue: QueueItem[]
  removeFromQueue: (vars: { showId: string; episodeNumber: string }) => void
  showId: string | undefined
  showMetaId?: string
  showMetaStatus?: string
  currentEpisode?: string | null
  episodes: string[]
  isAutoplayEnabled: boolean
  isCompleted: boolean
  showResumeModal: boolean
  nextEpisode: string | null
  previousEpisode: string | null
  navigate: (to: string) => void
  invalidateContinueWatching: () => void
  dispatch: React.Dispatch<Action>
}

// what happens when an episode ends: the queue, the autoplay, the next and
// the previous episode
export function useEpisodeEndFlow({
  videoRef,
  testClipActive,
  selectedSourceType,
  onEnded,
  queue,
  removeFromQueue,
  showId,
  showMetaId,
  showMetaStatus,
  currentEpisode,
  episodes,
  isAutoplayEnabled,
  isCompleted,
  showResumeModal,
  nextEpisode,
  previousEpisode,
  navigate,
  invalidateContinueWatching,
  dispatch,
}: UseEpisodeEndFlowOptions) {
  const [hasReachedEpisodeEnd, setHasReachedEpisodeEnd] = useState(false)
  const hasDismissedShowCompletedRef = useRef(false)
  const [queueCountdown, setQueueCountdown] = useState<number | null>(null)
  const [pendingQueueTransition, setPendingQueueTransition] = useState<{
    nextItem: QueueItem | null
    playedItem: QueueItem | null
  } | null>(null)
  const removeFromQueueRef = useRef(removeFromQueue)
  removeFromQueueRef.current = removeFromQueue

  const effectiveIsCompleted = isCompleted || hasReachedEpisodeEnd
  const isShowCompleted =
    effectiveIsCompleted && isShowFinale(episodes, currentEpisode ?? undefined, showMetaStatus)

  useEffect(() => {
    if (!hasReachedEpisodeEnd) {
      hasDismissedShowCompletedRef.current = false
    }
  }, [hasReachedEpisodeEnd])

  const handlePlaybackFinished = useCallback(() => {
    onEnded()

    const itemToRemove = queue.find(
      (item) => matchesQueueItem(item, showId, showMetaId) && item.episodeNumber === currentEpisode
    )

    if (queue.length > 0) {
      const activeQueueIndex = queue.findIndex(
        (item) =>
          matchesQueueItem(item, showId, showMetaId) && item.episodeNumber === currentEpisode
      )

      const nextItem = activeQueueIndex >= 0 ? queue[activeQueueIndex + 1] || null : queue[0]

      setPendingQueueTransition({ nextItem, playedItem: itemToRemove || null })
      setQueueCountdown(2)
    } else if (itemToRemove) {
      removeFromQueueRef.current({
        showId: itemToRemove.showId,
        episodeNumber: itemToRemove.episodeNumber,
      })
    }

    let didAutoplayNavigate = false
    if (isAutoplayEnabled && queue.length === 0) {
      const currentIndex = episodes.findIndex((ep) => ep === currentEpisode)
      if (currentIndex > -1 && currentIndex < episodes.length - 1) {
        const autoplayEpisode = episodes[currentIndex + 1]
        invalidateContinueWatching()
        navigate(`/watch/${showId}/${autoplayEpisode}`)
        didAutoplayNavigate = true
      }
    }

    if (
      !didAutoplayNavigate &&
      queue.length === 0 &&
      !pendingQueueTransition &&
      !hasDismissedShowCompletedRef.current
    ) {
      if (isShowFinale(episodes, currentEpisode ?? undefined, showMetaStatus)) {
        dispatch({ type: 'SET_STATE', payload: { showResumeModal: true } })
      }
    }
  }, [
    onEnded,
    navigate,
    queue,
    showId,
    showMetaId,
    showMetaStatus,
    currentEpisode,
    episodes,
    isAutoplayEnabled,
    pendingQueueTransition,
    dispatch,
    invalidateContinueWatching,
  ])

  const handleQueueTransition = useCallback(() => {
    if (queue.length === 0) return

    onEnded()

    const itemToRemove = queue.find(
      (item) => matchesQueueItem(item, showId, showMetaId) && item.episodeNumber === currentEpisode
    )
    const activeQueueIndex = queue.findIndex(
      (item) => matchesQueueItem(item, showId, showMetaId) && item.episodeNumber === currentEpisode
    )
    const nextItem = activeQueueIndex >= 0 ? queue[activeQueueIndex + 1] || null : queue[0]

    if (itemToRemove) {
      removeFromQueue({
        showId: itemToRemove.showId,
        episodeNumber: itemToRemove.episodeNumber,
      })
    }

    if (nextItem) {
      navigate(`/watch/${nextItem.showId}/${nextItem.episodeNumber}`)
    } else if (itemToRemove) {
      dispatch({ type: 'SET_STATE', payload: { showResumeModal: true } })
    }
  }, [onEnded, navigate, queue, removeFromQueue, showId, showMetaId, currentEpisode, dispatch])

  const handleNextEpisode = useCallback(() => {
    if (nextEpisode) {
      invalidateContinueWatching()
      setHasReachedEpisodeEnd(false)
      navigate(`/watch/${showId}/${nextEpisode}`)
    }
    dispatch({ type: 'SET_STATE', payload: { showResumeModal: false } })
  }, [nextEpisode, navigate, showId, dispatch, invalidateContinueWatching])

  const handleNShortcut = useCallback(() => {
    if (queue.length > 0) {
      handleQueueTransition()
    } else if (nextEpisode) {
      handleNextEpisode()
    } else {
      toast.error('No next episode available')
    }
  }, [queue.length, handleQueueTransition, handleNextEpisode, nextEpisode])

  const markShowCompletedDismissed = useCallback(() => {
    hasDismissedShowCompletedRef.current = true
  }, [])

  const resetReachedEpisodeEnd = useCallback(() => setHasReachedEpisodeEnd(false), [])

  const setReachedEpisodeEnd = useCallback(
    (reached: boolean) => setHasReachedEpisodeEnd(reached),
    []
  )

  const cancelQueueTransition = useCallback(() => {
    setPendingQueueTransition(null)
    setQueueCountdown(null)
  }, [])

  const handlePreviousEpisode = useCallback(() => {
    if (previousEpisode) {
      navigate(`/watch/${showId}/${previousEpisode}`)
    }
  }, [previousEpisode, navigate, showId])

  useEffect(() => {
    const videoElement = videoRef.current
    if (!videoElement) return
    const handleVideoEnd = () => {
      if (testClipActive) return
      handlePlaybackFinished()
    }
    videoElement.addEventListener('ended', handleVideoEnd)
    return () => {
      videoElement.removeEventListener('ended', handleVideoEnd)
    }
  }, [handlePlaybackFinished, videoRef, testClipActive])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (selectedSourceType !== 'iframe') return
      if (event.data?.type !== 'ANI_WEB_MEDIA_ENDED') return

      handlePlaybackFinished()
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [handlePlaybackFinished, selectedSourceType])

  useEffect(() => {
    if (!pendingQueueTransition || queueCountdown === null) return

    if (queueCountdown <= 0) {
      const { nextItem, playedItem } = pendingQueueTransition
      setPendingQueueTransition(null)
      setQueueCountdown(null)

      if (playedItem) {
        removeFromQueueRef.current({
          showId: playedItem.showId,
          episodeNumber: playedItem.episodeNumber,
        })
      }

      if (nextItem) {
        navigate(`/watch/${nextItem.showId}/${nextItem.episodeNumber}`)
      } else if (playedItem) {
        dispatch({ type: 'SET_STATE', payload: { showResumeModal: true } })
      }
      return
    }

    const timer = window.setTimeout(() => {
      setQueueCountdown((value) => (value === null ? null : value - 1))
    }, 1000)

    return () => window.clearTimeout(timer)
  }, [pendingQueueTransition, queueCountdown, navigate, dispatch])

  useEffect(() => {
    if (!hasReachedEpisodeEnd) return
    if (showResumeModal) return
    if (queue.length > 0) return
    if (pendingQueueTransition) return
    if (hasDismissedShowCompletedRef.current) return
    if (isShowCompleted) {
      dispatch({ type: 'SET_STATE', payload: { showResumeModal: true } })
    }
  }, [
    hasReachedEpisodeEnd,
    isShowCompleted,
    showResumeModal,
    queue.length,
    pendingQueueTransition,
    dispatch,
  ])

  return {
    hasReachedEpisodeEnd,
    effectiveIsCompleted,
    isShowCompleted,
    queueCountdown,
    pendingQueueTransition,
    handleQueueTransition,
    handleNextEpisode,
    handleNShortcut,
    handlePreviousEpisode,
    markShowCompletedDismissed,
    resetReachedEpisodeEnd,
    setReachedEpisodeEnd,
    cancelQueueTransition,
  }
}
