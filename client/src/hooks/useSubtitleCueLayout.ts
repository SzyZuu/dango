import { useEffect } from 'react'
import { buildCueCss, fitSubtitleSize, type SubtitleStyleSettings } from '../lib/subtitleStyle'

interface UseSubtitleCueLayoutOptions {
  videoRef: { current: HTMLVideoElement | null }
  videoBoxH: number
  style: SubtitleStyleSettings
  sourceKey: string
  activeSubtitleTrack: string | null
  availableSubtitles: unknown[]
}

// the native cue renderer stacks the lines itself, this restacks them so a
// multi line cue does not overlap
export function useSubtitleCueLayout({
  videoRef,
  videoBoxH,
  style,
  sourceKey,
  activeSubtitleTrack,
  availableSubtitles,
}: UseSubtitleCueLayoutOptions) {
  useEffect(() => {
    const styleId = 'dynamic-subtitle-styles'
    let styleTag = document.getElementById(styleId)
    if (!styleTag) {
      styleTag = document.createElement('style')
      styleTag.id = styleId
      document.head.appendChild(styleTag)
    }

    styleTag.textContent = buildCueCss(style)

    const video = videoRef.current
    if (!video) return
    const fittedSize = fitSubtitleSize(style.fontSize, videoBoxH || video.clientHeight || 720)
    styleTag.textContent = buildCueCss({ ...style, fontSize: fittedSize })

    const getPos = () => {
      const raw = Number(style.position)
      const lift = isNaN(raw) ? 0 : Math.max(0, Math.min(100, raw))
      return Math.max(0, Math.min(100, 100 - lift))
    }

    const setCueLine = (cue: unknown, line: number) => {
      try {
        const vttCue = cue as { snapToLines?: boolean; line?: number }
        vttCue.snapToLines = false
        vttCue.line = line
      } catch {
        // ignore
      }
    }

    const cueMetrics = () => {
      const px = fittedSize * 16
      const h = video.videoHeight || video.clientHeight || 720
      const w = video.videoWidth || video.clientWidth || 1280
      return { step: ((px * 1.3) / h) * 100, chars: Math.max(20, Math.floor(w / (px * 0.55))) }
    }

    const restackTrack = (track: TextTrack) => {
      const pos = getPos()
      const active = Array.from(track.activeCues ?? [])
      if (active.length <= 1) {
        active.forEach((cue) => setCueLine(cue, pos))
        return
      }
      const { step, chars } = cueMetrics()
      let bottom = pos
      for (let i = active.length - 1; i >= 0; i--) {
        const text = String((active[i] as { text?: unknown }).text ?? '').replace(/<[^>]*>/g, '')
        const visual = text
          .split('\n')
          .reduce((n, seg) => n + Math.max(1, Math.ceil(seg.length / chars)), 0)
        const top = bottom - visual * step
        setCueLine(active[i], Math.max(0, top))
        bottom = top - step * 0.4
      }
    }

    const applyToTrack = (track: TextTrack) => {
      if (!track.cues) return
      const pos = getPos()
      Array.from(track.cues).forEach((cue: unknown) => setCueLine(cue, pos))
      if (track.mode === 'showing') restackTrack(track)
    }

    const applyToAllTracks = () => {
      Array.from(video.textTracks).forEach(applyToTrack)
    }

    applyToAllTracks()

    const handleCueChange = (e: Event) => {
      const track = e.target as TextTrack
      if (track.mode === 'showing') restackTrack(track)
    }

    Array.from(video.textTracks).forEach((t) => {
      t.addEventListener('cuechange', handleCueChange)
    })

    const handleAddTrack = () => {
      Array.from(video.textTracks).forEach((t) => {
        t.removeEventListener('cuechange', handleCueChange)
        t.addEventListener('cuechange', handleCueChange)
      })
      applyToAllTracks()
    }
    video.textTracks.addEventListener('addtrack', handleAddTrack)
    video.textTracks.addEventListener('removetrack', handleAddTrack)

    const trackElements = Array.from(video.querySelectorAll('track'))
    const handleTrackLoad = () => {
      applyToAllTracks()
    }
    trackElements.forEach((el) => {
      el.addEventListener('load', handleTrackLoad)
    })

    return () => {
      Array.from(video.textTracks).forEach((t) => {
        t.removeEventListener('cuechange', handleCueChange)
      })
      video.textTracks.removeEventListener('addtrack', handleAddTrack)
      video.textTracks.removeEventListener('removetrack', handleAddTrack)
      trackElements.forEach((el) => {
        el.removeEventListener('load', handleTrackLoad)
      })
    }
  }, [style, videoBoxH, videoRef, sourceKey, activeSubtitleTrack, availableSubtitles])
}
