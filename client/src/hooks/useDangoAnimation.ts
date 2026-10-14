import { useEffect } from 'react'
import { useSetting } from './useSettings'
import { useLowEndMode } from '../contexts/LowEndModeContext'
import { gazeAt } from '../lib/dangoGaze'
import { hitTest, OFFSETS } from '../lib/dangoLayout'
import {
  pickResting,
  PET_FACE,
  SLEEP_FACE,
  IDLE_MS,
  PETTLE_MS,
  PET_PAD,
  SHUFFLE_MS,
  SHUFFLE_JITTER_MS,
  WAKE_STAGGER,
  NUDGE,
} from '../lib/dangoFaces'

type Slot = SVGGElement

const FACE = 'data-dango-face'
const HOVER = 'data-dango-hover'
const CHEER = 'data-dango-cheer'
const NUDGE_ATTR = 'data-dango-nudge'

const logos = () => document.querySelectorAll<SVGSVGElement>('svg[data-dango-gaze-origin]')
const slots = () => document.querySelectorAll<Slot>('[data-dango-face-slot]')
const eyeGroups = (svg: SVGSVGElement) => svg.querySelectorAll<SVGGElement>('[data-dango-eye]')
const allEyes = () => document.querySelectorAll<SVGGElement>('[data-dango-eye]')

export const useDangoAlive = () => {
  const { data: gazeSetting } = useSetting('dangoGaze')
  const { lowEndMode } = useLowEndMode()
  return gazeSetting !== 'false' && !lowEndMode
}

export const useDangoAnimation = () => {
  const alive = useDangoAlive()

  useEffect(() => {
    if (!alive) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const resting: string[] = OFFSETS.map(() => 'normal')
    let hovered = -1
    let petting = -1
    let asleep = false
    let turn = -1
    let frame = 0
    let px = 0
    let py = 0
    let idleTimer = 0
    let settleTimer = 0
    const timers: number[] = []

    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        timers.splice(timers.indexOf(id), 1)
        fn()
      }, ms)
      timers.push(id)
    }

    const setOn = (index: number, attr: string, on: boolean) => {
      slots().forEach((el) => {
        if (Number(el.getAttribute('data-dango-face-slot')) !== index) return
        if (on) el.setAttribute(attr, '')
        else el.removeAttribute(attr)
      })
    }

    const clearOn = (attr: string) => slots().forEach((el) => el.removeAttribute(attr))

    const pulse = (index: number, attr: string, ms: number) => {
      clearOn(attr)
      requestAnimationFrame(() => {
        setOn(index, attr, true)
        later(() => clearOn(attr), ms)
      })
    }

    const paint = () => {
      slots().forEach((el) => {
        const i = Number(el.getAttribute('data-dango-face-slot'))
        el.setAttribute(FACE, petting === i ? PET_FACE : resting[i])
        if (hovered === i) el.setAttribute(HOVER, '')
        else el.removeAttribute(HOVER)
      })
    }

    const setPetting = (index: number) => {
      if (index === petting) return
      if (petting >= 0) setOn(petting, CHEER, false)
      petting = index
      if (index >= 0) setOn(index, CHEER, true)
    }

    const armSettle = () => {
      window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => {
        setPetting(-1)
        paint()
      }, PETTLE_MS)
    }

    const dropPetting = () => {
      window.clearTimeout(settleTimer)
      setPetting(-1)
    }

    const wake = () => {
      asleep = false
      WAKE_STAGGER.forEach((delay, i) => {
        later(() => {
          resting[i] = pickResting()
          if (i === NUDGE.from) later(() => pulse(NUDGE.to, NUDGE_ATTR, 520), NUDGE.after)
          paint()
        }, delay)
      })
    }

    const sleep = () => {
      asleep = true
      resting.fill(SLEEP_FACE)
      dropPetting()
      paint()
    }

    const armIdle = () => {
      window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(sleep, IDLE_MS)
    }

    const shuffle = () => {
      if (!asleep) {
        turn = (turn + 1) % resting.length
        resting[turn] = pickResting(Math.random(), resting[turn])
        paint()
      }
      later(shuffle, SHUFFLE_MS + Math.random() * SHUFFLE_JITTER_MS)
    }

    const step = () => {
      const boxes = Array.from(logos(), (el) => [el, el.getBoundingClientRect()] as const)

      boxes.forEach(([svg, rect]) => {
        eyeGroups(svg).forEach((el) => {
          const { x, y } = gazeAt(px, py, rect, OFFSETS[Number(el.getAttribute('data-dango-eye'))])
          el.style.setProperty('--dango-gaze-x', x.toFixed(3))
          el.style.setProperty('--dango-gaze-y', y.toFixed(3))
        })
      })

      const box =
        boxes.find(
          ([, b]) => px >= b.left && px <= b.right && py >= b.top && py <= b.bottom
        )?.[1] ?? null
      const wasHover = hovered
      const wasPet = petting
      const strict = box ? hitTest(px, py, box) : -1
      const loose = strict >= 0 ? strict : box ? hitTest(px, py, box, PET_PAD) : -1
      hovered = strict
      if (loose >= 0) {
        setPetting(loose)
        armSettle()
      } else {
        dropPetting()
      }
      if (wasHover !== hovered || wasPet !== petting) paint()

      if (asleep) wake()
      armIdle()
    }

    const onMove = (e: PointerEvent) => {
      px = e.clientX
      py = e.clientY
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        step()
      })
    }

    const onOut = (e: PointerEvent) => {
      if (e.relatedTarget) return
      hovered = -1
      dropPetting()
      paint()
      armIdle()
    }

    paint()
    armIdle()
    later(shuffle, SHUFFLE_MS)
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerout', onOut)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(idleTimer)
      window.clearTimeout(settleTimer)
      timers.forEach(window.clearTimeout)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerout', onOut)
      allEyes().forEach((el) => {
        el.style.removeProperty('--dango-gaze-x')
        el.style.removeProperty('--dango-gaze-y')
      })
      slots().forEach((el) => {
        el.setAttribute(FACE, 'normal')
        el.removeAttribute(HOVER)
        el.removeAttribute(CHEER)
        el.removeAttribute(NUDGE_ATTR)
      })
    }
  }, [alive])
}
