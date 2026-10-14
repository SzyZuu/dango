import { describe, it, expect } from 'vitest'
import { hitTest, VIEWBOX, OFFSETS, BALL, GAP, EYE } from './dangoLayout'
import { pickResting, RESTING, WAKE_STAGGER, NUDGE, PET_PAD } from './dangoFaces'
import { gazeAt, GAZE_REACH } from './dangoGaze'

describe('pickResting', () => {
  it('always returns a known resting face', () => {
    for (let i = 0; i <= 100; i++) {
      expect(RESTING).toContain(pickResting(i / 100))
    }
  })

  it('keeps both resting faces in play', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 1000; i++) seen.add(pickResting(i / 1000))
    expect([...seen].sort()).toEqual(['normal', 'squint'])
  })

  it('leans towards the open-eyed normal face', () => {
    let normal = 0
    for (let i = 0; i < 1000; i++) if (pickResting(i / 1000) === 'normal') normal++
    expect(normal / 1000).toBeGreaterThan(0.65)
  })

  it('never re-picks the face it already has, so nothing can stick', () => {
    RESTING.forEach((current) => {
      const seen = new Set<string>()
      for (let i = 0; i < 1000; i++) {
        const next = pickResting(i / 1000, current)
        expect(next).not.toBe(current)
        seen.add(next)
      }
      expect(seen).toEqual(new Set(RESTING.filter((f) => f !== current)))
    })
  })
})

describe('wake schedule', () => {
  it('wakes one dango per stagger slot, never all at once', () => {
    expect(WAKE_STAGGER).toHaveLength(OFFSETS.length)
    for (let i = 1; i < WAKE_STAGGER.length; i++) {
      expect(WAKE_STAGGER[i]).toBeGreaterThan(WAKE_STAGGER[i - 1])
    }
  })

  it('nudges a different dango than the one that wakes', () => {
    expect(NUDGE.from).not.toBe(NUDGE.to)
    expect(OFFSETS.map((_, i) => i)).toContain(NUDGE.to)
  })

  it('startles the next dango as it opens its eyes, not before', () => {
    const lands = WAKE_STAGGER[NUDGE.from] + NUDGE.after - WAKE_STAGGER[NUDGE.to]
    expect(lands).toBeGreaterThan(0)
    expect(lands).toBeLessThan(200)
  })
})

describe('gazeAt', () => {
  const scale = 2
  const rect = {
    left: 100,
    top: 50,
    width: VIEWBOX.w * scale,
    height: VIEWBOX.h * scale,
  } as DOMRect

  const at = (vx: number, vy: number) => ({
    x: rect.left + (vx - VIEWBOX.x) * scale,
    y: rect.top + (vy - VIEWBOX.y) * scale,
  })

  const eyeAt = (i: number, dx: number, dy: number) => {
    const o = OFFSETS[i]
    return at(o.x + EYE.x + dx, o.y + EYE.y + dy)
  }

  it('is centred when the cursor sits on that dango', () => {
    const p = eyeAt(0, 0, 0)
    const aim = gazeAt(p.x, p.y, rect, OFFSETS[0])
    expect(aim.x).toBeCloseTo(0)
    expect(aim.y).toBeCloseTo(0)
  })

  it('points at the cursor, scaling with the distance from its own dango', () => {
    const p = eyeAt(0, GAZE_REACH / 2, GAZE_REACH / 4)
    expect(gazeAt(p.x, p.y, rect, OFFSETS[0]).x).toBeCloseTo(0.5)
    expect(gazeAt(p.x, p.y, rect, OFFSETS[0]).y).toBeCloseTo(0.25)
  })

  it('aims each dango from where it sits, not from a shared origin', () => {
    const last = OFFSETS.length - 1
    const p = eyeAt(last, GAZE_REACH / 2, 0)
    expect(gazeAt(p.x, p.y, rect, OFFSETS[last]).x).toBeCloseTo(0.5)
    expect(gazeAt(p.x, p.y, rect, OFFSETS[0]).x).toBe(1)
  })

  it('never wraps past the reach — a cursor to the left keeps them looking left', () => {
    const p = eyeAt(0, -5000, -5000)
    expect(gazeAt(p.x, p.y, rect, OFFSETS[0])).toEqual({ x: -1, y: -1 })
    const q = eyeAt(0, 5000, 5000)
    expect(gazeAt(q.x, q.y, rect, OFFSETS[0])).toEqual({ x: 1, y: 1 })
  })
})

describe('hitTest', () => {
  const scale = 2
  const rect = {
    left: 100,
    top: 50,
    width: VIEWBOX.w * scale,
    height: VIEWBOX.h * scale,
  } as DOMRect

  const at = (vx: number, vy: number) => ({
    x: rect.left + (vx - VIEWBOX.x) * scale,
    y: rect.top + (vy - VIEWBOX.y) * scale,
  })

  it('misses when the logo has no size', () => {
    expect(hitTest(0, 0, { width: 0 } as DOMRect)).toBe(-1)
  })

  it('finds each ball and only that ball', () => {
    OFFSETS.forEach((o, i) => {
      const p = at(o.x + BALL.w / 2, o.y + BALL.h / 2)
      expect(hitTest(p.x, p.y, rect), `ball ${i}`).toBe(i)
    })
  })

  it('covers the whole ball, head and lower half alike', () => {
    const o = OFFSETS[0]
    const top = at(o.x + 2, o.y + 0.5)
    const bottom = at(o.x + 2, o.y + BALL.h - 0.5)
    expect(hitTest(top.x, top.y, rect)).toBe(0)
    expect(hitTest(bottom.x, bottom.y, rect)).toBe(0)
  })

  it('misses the gaps between balls and the empty margins', () => {
    const gap = at(OFFSETS[0].x + BALL.w + 0.5, OFFSETS[0].y + 5)
    expect(hitTest(gap.x, gap.y, rect)).toBe(-1)
    expect(hitTest(rect.left - 500, rect.top - 500, rect)).toBe(-1)
  })

  it('misses above and below the skewer', () => {
    const above = at(OFFSETS[0].x + 5, OFFSETS[0].y - 1)
    const below = at(OFFSETS[0].x + 5, OFFSETS[0].y + BALL.h + 1)
    expect(hitTest(above.x, above.y, rect)).toBe(-1)
    expect(hitTest(below.x, below.y, rect)).toBe(-1)
  })

  it('keeps a ball alive when the pointer overshoots its edge', () => {
    const o = OFFSETS[0]
    const edge = at(o.x + BALL.w + PET_PAD / 2, o.y + 5)
    expect(hitTest(edge.x, edge.y, rect)).toBe(-1)
    expect(hitTest(edge.x, edge.y, rect, PET_PAD)).toBe(0)
  })

  it('still lets go once the pointer is clear of the padding', () => {
    const o = OFFSETS[0]
    const past = at(o.x + BALL.w + PET_PAD + 0.2, o.y + 5)
    expect(hitTest(past.x, past.y, rect, PET_PAD)).toBe(-1)
  })

  it('leaves the gap between dangos escapable', () => {
    const middle = at(OFFSETS[0].x + BALL.w + GAP / 2, OFFSETS[0].y + 5)
    expect(hitTest(middle.x, middle.y, rect, PET_PAD)).toBe(-1)
  })
})
