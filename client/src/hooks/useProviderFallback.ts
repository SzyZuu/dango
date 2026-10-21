import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { trpcClient } from '../lib/trpc'
import { savePreferredProvider } from '../reducers/playerReducer'
import type { Action } from '../reducers/playerReducer'
import {
  getStoredFallbackAction,
  storeFallbackAction,
  type FallbackChoice,
} from '../lib/fallbackChoice'
import type { VideoSource } from '../types/player'

interface UseProviderFallbackOptions {
  showId: string | undefined
  episodeNumber: string | undefined
  currentMode: 'sub' | 'dub' | undefined
  selectedProvider: string
  selectedSourceType: string | undefined
  videoSources: VideoSource[]
  isAdult: boolean | undefined
  providerOrder: string[]
  matureProviders: Set<string>
  setPreferredSource: (source: string) => void
  dispatch: React.Dispatch<Action>
  showControls: (visible: boolean) => void
}

// when a stream dies the player asks the user: an iframe fallback, another
// provider or nothing
export function useProviderFallback({
  showId,
  episodeNumber,
  currentMode,
  selectedProvider,
  selectedSourceType,
  videoSources,
  isAdult,
  providerOrder,
  matureProviders,
  setPreferredSource,
  dispatch,
  showControls,
}: UseProviderFallbackOptions) {
  const hasAutoFallbackRef = useRef(false)
  const triedProvidersRef = useRef<string[]>([])
  const fallbackDismissedRef = useRef(false)
  const [fallbackPrompt, setFallbackPrompt] = useState<{ retryFailed: boolean } | null>(null)
  const [isRetryingProvider, setIsRetryingProvider] = useState(false)
  const [rememberFallbackChoice, setRememberFallbackChoice] = useState(false)
  const [fallbackChoice, setFallbackChoiceState] = useState<FallbackChoice>(
    () => getStoredFallbackAction() ?? 'ask'
  )
  const updateFallbackChoice = useCallback((value: FallbackChoice) => {
    setFallbackChoiceState(value)
    storeFallbackAction(value === 'ask' ? null : value)
  }, [])
  const fallbackChoiceRef = useRef(fallbackChoice)
  useEffect(() => {
    fallbackChoiceRef.current = fallbackChoice
  }, [fallbackChoice])

  const videoSourcesRef = useRef(videoSources)
  videoSourcesRef.current = videoSources

  const resetFallback = useCallback(() => {
    hasAutoFallbackRef.current = false
    triedProvidersRef.current = []
    fallbackDismissedRef.current = false
    setFallbackPrompt(null)
    setIsRetryingProvider(false)
  }, [])

  useEffect(() => {
    resetFallback()
  }, [resetFallback, showId, episodeNumber])

  const switchToIframeFallback = useCallback(
    (fallbackSource: VideoSource) => {
      if (hasAutoFallbackRef.current) return
      hasAutoFallbackRef.current = true
      const bestLink = fallbackSource.links[0]
      setPreferredSource(fallbackSource.sourceName)
      dispatch({
        type: 'SET_STATE',
        payload: { selectedSource: fallbackSource, selectedLink: bestLink },
      })
      setFallbackPrompt(null)
    },
    [dispatch, setPreferredSource]
  )

  const findIframeFallback = useCallback((): VideoSource | null => {
    const sources = videoSourcesRef.current
    const fallbackSource = sources.find((s) => s.type === 'iframe')
    return fallbackSource?.links?.length ? fallbackSource : null
  }, [])

  const runProviderRetry = useCallback(async () => {
    const ordered = providerOrder.filter((provider) => {
      if (triedProvidersRef.current.includes(provider)) return false
      const mature = matureProviders.has(provider)
      if (isAdult === undefined) return true
      return mature === isAdult
    })
    setIsRetryingProvider(true)
    try {
      for (const provider of ordered) {
        triedProvidersRef.current.push(provider)
        let sources: VideoSource[] | null = null
        try {
          sources = (await trpcClient.data.video.query({
            showId,
            episodeNumber,
            mode: currentMode,
            provider,
          })) as VideoSource[] | null
        } catch {
          continue
        }
        const pool = (sources ?? []).filter((s) => {
          const name = s.sourceName.toLowerCase()
          if (currentMode === 'dub') {
            return name.includes('eng') || name.includes('dub')
          }
          return (
            name.includes('jpn') ||
            name.includes('sub') ||
            (!name.includes('eng') && !name.includes('dub'))
          )
        })
        const withDirect = pool.length > 0 ? pool : (sources ?? [])
        const direct = withDirect.find((s) => s.type !== 'iframe' && s.links?.length)
        if (direct) {
          triedProvidersRef.current = [selectedProvider]
          fallbackDismissedRef.current = false
          dispatch({
            type: 'SET_STATE',
            payload: {
              selectedProvider: provider,
              videoSources: [],
              selectedSource: null,
              selectedLink: null,
              loadingVideo: true,
            },
          })
          savePreferredProvider(provider, isAdult === true)
          setFallbackPrompt(null)
          toast.success(`Switched to ${provider} (direct stream)`)
          return
        }
      }
      setFallbackPrompt({ retryFailed: true })
      toast.error('No working direct stream found on other providers')
    } finally {
      setIsRetryingProvider(false)
    }
  }, [
    showId,
    episodeNumber,
    currentMode,
    isAdult,
    selectedProvider,
    dispatch,
    providerOrder,
    matureProviders,
  ])

  const handleVideoSourceError = useCallback(() => {
    if (hasAutoFallbackRef.current || fallbackDismissedRef.current) return
    if (selectedSourceType !== 'player') return
    const fallbackSource = findIframeFallback()
    if (!fallbackSource) return

    if (!triedProvidersRef.current.includes(selectedProvider)) {
      triedProvidersRef.current.push(selectedProvider)
    }
    const choice = fallbackChoiceRef.current
    if (choice === 'iframe') {
      switchToIframeFallback(fallbackSource)
      return
    }
    if (choice === 'retry') {
      void runProviderRetry()
      return
    }
    showControls(true)
    setFallbackPrompt({ retryFailed: false })
  }, [
    selectedSourceType,
    selectedProvider,
    findIframeFallback,
    switchToIframeFallback,
    runProviderRetry,
    showControls,
  ])

  const dismissFallbackPrompt = useCallback(() => {
    fallbackDismissedRef.current = true
    setFallbackPrompt(null)
    setRememberFallbackChoice(false)
  }, [])

  const chooseIframeFallback = useCallback(() => {
    if (rememberFallbackChoice) updateFallbackChoice('iframe')
    const fallbackSource = findIframeFallback()
    if (fallbackSource) switchToIframeFallback(fallbackSource)
    else setFallbackPrompt(null)
  }, [rememberFallbackChoice, updateFallbackChoice, findIframeFallback, switchToIframeFallback])

  const chooseProviderRetry = useCallback(() => {
    if (rememberFallbackChoice) updateFallbackChoice('retry')
    void runProviderRetry()
  }, [rememberFallbackChoice, updateFallbackChoice, runProviderRetry])

  return {
    fallbackPrompt,
    isRetryingProvider,
    rememberFallbackChoice,
    setRememberFallbackChoice,
    fallbackChoice,
    updateFallbackChoice,
    dismissFallbackPrompt,
    chooseIframeFallback,
    chooseProviderRetry,
    handleVideoSourceError,
    resetFallback,
  }
}
