import { useEffect } from 'react'
import { useSetting } from './useSettings'
import { useLowEndMode } from '../contexts/LowEndModeContext'
import { gazeOffset } from '../lib/dangoGaze'
import { hitTest } from '../lib/dangoLayout'
import {
  pickResting,
  PET_FACE,
  SLEEP_FACE,
  IDLE_MS,
  PETTLE_MS,
  PET_PAD,
  WAKE_STAGGER,
  NUDGE,
} from '../lib/dangoFaces'

type Slot = SVGGElement

const slots = () => document.querySelectorAll<Slot>('[data-dango-face-slot]')
const slotOf = (target: EventTarget | null) =>
  (target as Element | null)?.closest?.('[data-dango-face-slot]') ?? null

export const useDangoAnimation = () => {
  const { data: gazeSetting } = useSetting('dangoGaze')
  const { lowEndMode } = useLowEndMode()
  const alive = gazeSetting !== 'false' && !lowEndMode

  useEffect(() => {
    if (!alive) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const resting = ['normal', 'normal', 'normal']
    let hovered = -1
    let petting = -1
    let asleep = false
    let idleTimer = 0
    let settleTimer = 0
    const timers: number[] = []

    const boxAt = (x: number, y: number) => {
      const boxes = Array.from(
        document.querySelectorAll<SVGSVGElement>('svg[data-dango-gaze-origin]')
      ).map((el) => el.getBoundingClientRect())
      return (
        boxes.find((b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) ?? boxes[0]
      )
    }

    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        timers.splice(timers.indexOf(id), 1)
        fn()
      }, ms)
      timers.push(id)
    }

    const pulse = (index: number, attr: string, ms: number) => {
      const clear = () => slots().forEach((el) => el.removeAttribute(attr))
      clear()
      requestAnimationFrame(() => {
        slots().forEach((el) => {
          if (Number(el.getAttribute('data-dango-face-slot')) === index) el.setAttribute(attr, '')
        })
        later(clear, ms)
      })
    }

    const setOn = (index: number, attr: string, on: boolean) => {
      slots().forEach((el) => {
        if (Number(el.getAttribute('data-dango-face-slot')) !== index) return
        if (on) el.setAttribute(attr, '')
        else el.removeAttribute(attr)
      })
    }

    const paint = () => {
      slots().forEach((el) => {
        const i = Number(el.getAttribute('data-dango-face-slot'))
        el.setAttribute('data-face', petting === i ? PET_FACE : resting[i])
        if (hovered === i) el.setAttribute('data-hover', '')
        else el.removeAttribute('data-hover')
      })
    }

    const setPetting = (index: number) => {
      if (index === petting) return
      if (petting >= 0) setOn(petting, 'data-cheer', false)
      petting = index
      if (index >= 0) setOn(index, 'data-cheer', true)
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
          if (i === NUDGE.from) later(() => pulse(NUDGE.to, 'data-nudge', 520), NUDGE.after)
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

    const onMove = (e: PointerEvent) => {
      const box = boxAt(e.clientX, e.clientY)
      if (!box) return

      const { x, y } = gazeOffset(e.clientX, e.clientY, box)
      const root = document.documentElement.style
      root.setProperty('--dango-gaze-x', x.toFixed(3))
      root.setProperty('--dango-gaze-y', y.toFixed(3))

      const wasHover = hovered
      const wasPet = petting
      const strict = hitTest(e.clientX, e.clientY, box)
      const loose = strict >= 0 ? strict : hitTest(e.clientX, e.clientY, box, PET_PAD)
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

    const onOut = (e: PointerEvent) => {
      const from = slotOf(e.target)
      const slotIndex = from?.getAttribute('data-dango-face-slot')
      const to = slotOf(e.relatedTarget)
      if (!from || to?.getAttribute('data-dango-face-slot') === slotIndex) return
      hovered = -1
      dropPetting()
      paint()
      armIdle()
    }

    paint()
    armIdle()
    window.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerout', onOut)
    return () => {
      window.clearTimeout(idleTimer)
      window.clearTimeout(settleTimer)
      timers.forEach(window.clearTimeout)
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerout', onOut)
      document.documentElement.style.removeProperty('--dango-gaze-x')
      document.documentElement.style.removeProperty('--dango-gaze-y')
      slots().forEach((el) => {
        el.setAttribute('data-face', 'normal')
        el.removeAttribute('data-hover')
        el.removeAttribute('data-cheer')
      })
    }
  }, [alive])
}
