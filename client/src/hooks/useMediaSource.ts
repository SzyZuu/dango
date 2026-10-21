import { useEffect, useRef } from 'react'
import { loadHls } from '../lib/hls'
import { pickSubtitleIndex } from '../lib/subtitles'
import type Hls from 'hls.js'
import type { SubtitleTrack, VideoLink, VideoSource } from '../types/player'

interface UseMediaSourceOptions {
  videoRef: { current: HTMLVideoElement | null }
  selectedSource: VideoSource | null
  selectedLink: VideoLink | null
  loadingVideo: boolean
  testClipActive: boolean
  resumeTime: number
  showResumeModal: boolean
  calibReturnRef: { current: number | null }
  setAvailableSubtitles: (tracks: SubtitleTrack[]) => void
  setActiveSubtitleTrack: (track: string) => void
  showControls: (visible: boolean) => void
  onFatalError: () => void
}

// attaches the stream to the video element: the hls config, the subtitle
// tracks, the resume seek and the saved volume
export function useMediaSource({
  videoRef,
  selectedSource,
  selectedLink,
  loadingVideo,
  testClipActive,
  resumeTime,
  showResumeModal,
  calibReturnRef,
  setAvailableSubtitles,
  setActiveSubtitleTrack,
  showControls,
  onFatalError,
}: UseMediaSourceOptions) {
  const hlsInstance = useRef<Hls | null>(null)
  const seekToTimeRef = useRef<number>(0)
  const resumeTimeRef = useRef(resumeTime)
  const showResumeModalRef = useRef(showResumeModal)
  const onFatalErrorRef = useRef(onFatalError)
  onFatalErrorRef.current = onFatalError

  useEffect(() => {
    resumeTimeRef.current = resumeTime
    showResumeModalRef.current = showResumeModal
  }, [resumeTime, showResumeModal])

  useEffect(() => {
    const videoElement = videoRef.current
    if (!videoElement) return

    let cancelled = false
    if (hlsInstance.current) {
      hlsInstance.current.destroy()
      hlsInstance.current = null
    }

    if (loadingVideo || selectedSource) {
      videoElement.pause()
      videoElement.removeAttribute('src')
      videoElement.load()
    }

    while (videoElement.firstChild) {
      videoElement.removeChild(videoElement.firstChild)
    }

    if (testClipActive) {
      videoElement.src = '/av-sync-test.mp4'
      videoElement.play().catch(() => {
        showControls(true)
      })
      return () => {
        cancelled = true
      }
    }

    if (!selectedSource || !selectedLink) return

    if (selectedSource.type === 'iframe') {
      seekToTimeRef.current = 0
      return
    }

    if (calibReturnRef.current != null) {
      seekToTimeRef.current = calibReturnRef.current
      calibReturnRef.current = null
    } else if (resumeTimeRef.current > 5 && !showResumeModalRef.current) {
      seekToTimeRef.current = resumeTimeRef.current
    } else if (showResumeModalRef.current) {
      seekToTimeRef.current = 0
    }

    let proxiedUrl = selectedLink.link
    if (!proxiedUrl.startsWith('/api/proxy')) {
      proxiedUrl = `/api/proxy?url=${encodeURIComponent(proxiedUrl)}`
      if (selectedLink.headers?.Referer) {
        proxiedUrl += `&referer=${encodeURIComponent(selectedLink.headers.Referer)}`
      }
    }

    if (selectedSource.subtitles) {
      const subtitlesEnabled = localStorage.getItem('playerSubtitlesEnabled') !== 'false'
      let lastKey: string | null = null
      try {
        lastKey = localStorage.getItem('playerLastSubtitle')
      } catch {
        // ignore
      }
      const pickedIdx = pickSubtitleIndex(selectedSource.subtitles, {
        lastKey,
        enabled: subtitlesEnabled,
      })
      const pickedTrack = pickedIdx >= 0 ? selectedSource.subtitles[pickedIdx] : null
      selectedSource.subtitles.forEach((sub) => {
        const track = document.createElement('track')
        track.kind = 'subtitles'
        track.label = sub.label
        track.srclang = sub.lang

        const subSrc = sub.src ?? sub.url
        if (subSrc) {
          let subUrl = `/api/subtitle-proxy?url=${encodeURIComponent(subSrc)}`
          const subReferer = selectedLink.headers?.Referer
          if (subReferer) {
            subUrl += `&referer=${encodeURIComponent(subReferer)}`
          }
          track.src = subUrl
        }

        if (pickedTrack && sub.label === pickedTrack.label && sub.lang === pickedTrack.lang) {
          track.default = true
        }
        videoElement.appendChild(track)
      })
      if (!subtitlesEnabled) {
        setActiveSubtitleTrack('off')
      }
      setAvailableSubtitles(selectedSource.subtitles)
    }

    const targetTime = seekToTimeRef.current
    seekToTimeRef.current = 0

    const handleLoaded = () => {
      if (targetTime > 0) {
        videoElement.currentTime = targetTime
      }
    }
    videoElement.addEventListener('loadedmetadata', handleLoaded, { once: true })

    const shouldAutoPlay = !(showResumeModalRef.current && resumeTimeRef.current > 5)
    const playWhenReady = () => {
      if (shouldAutoPlay) {
        videoElement.play().catch(() => {
          showControls(true)
        })
      }
    }

    if (selectedLink.hls) {
      void (async () => {
        const HlsClass = await loadHls()
        if (cancelled) return
        if (!HlsClass || !HlsClass.isSupported()) {
          videoElement.src = proxiedUrl
          playWhenReady()
          return
        }
        const isLowEnd = document.body.classList.contains('low-end')
        const hls = new HlsClass({
          maxBufferLength: isLowEnd ? 15 : 30,
          maxMaxBufferLength: isLowEnd ? 30 : 60,
          maxBufferSize: isLowEnd ? 25 * 1000 * 1000 : 60 * 1000 * 1000,
          startLevel: -1,
          enableWorker: true,
        })
        hlsInstance.current = hls
        hls.on(HlsClass.Events.ERROR, (_event, data) => {
          if (data.fatal) onFatalErrorRef.current()
        })
        const hasManualSubs = (selectedSource.subtitles?.length ?? 0) > 0
        const disableEmbeddedSubs = () => {
          try {
            if (
              hasManualSubs &&
              typeof hls.subtitleTrack === 'number' &&
              hls.subtitleTrack !== -1
            ) {
              hls.subtitleTrack = -1
            }
          } catch {
            // ignore
          }
        }
        hls.on(HlsClass.Events.SUBTITLE_TRACK_SWITCH, (_event, data) => {
          if (data?.id !== -1) disableEmbeddedSubs()
        })
        disableEmbeddedSubs()
        hls.loadSource(proxiedUrl)
        hls.attachMedia(videoElement)
        hls.once(HlsClass.Events.MANIFEST_PARSED, () => {
          if (!cancelled) playWhenReady()
        })
      })()
    } else {
      videoElement.src = proxiedUrl
      playWhenReady()
    }

    const savedVolume = localStorage.getItem('playerVolume')
    const savedMuted = localStorage.getItem('playerMuted')

    if (savedVolume !== null) {
      videoElement.volume = parseFloat(savedVolume)
    }
    if (savedMuted !== null) {
      videoElement.muted = savedMuted === 'true'
    }

    return () => {
      cancelled = true
      videoElement.removeEventListener('loadedmetadata', handleLoaded)
      if (hlsInstance.current) {
        hlsInstance.current.destroy()
        hlsInstance.current = null
      }
    }
  }, [
    selectedSource,
    selectedLink,
    videoRef,
    calibReturnRef,
    loadingVideo,
    testClipActive,
    setActiveSubtitleTrack,
    setAvailableSubtitles,
    showControls,
  ])

  // the page keeps the position when the user picks another source
  return { seekToTimeRef }
}
