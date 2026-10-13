import { describe, it, expect } from 'vitest'
import { hitTest, VIEWBOX, OFFSETS, BALL, GAP } from './dangoLayout'
import { PET_PAD } from './dangoFaces'

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

describe('hitTest', () => {
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
    expect(hitTest(-500, -500, rect)).toBe(-1)
  })

  it('misses above and below the skewer', () => {
    const above = at(OFFSETS[0].x + 5, OFFSETS[0].y - 1)
    const below = at(OFFSETS[0].x + 5, OFFSETS[0].y + BALL.h + 1)
    expect(hitTest(above.x, above.y, rect)).toBe(-1)
    expect(hitTest(below.x, below.y, rect)).toBe(-1)
  })
})

describe('padded hit test', () => {
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
