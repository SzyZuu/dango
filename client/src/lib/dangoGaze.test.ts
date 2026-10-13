import { describe, it, expect } from 'vitest'
import { gazeOffset, GAZE_REACH } from './dangoGaze'

const logo = { left: 100, top: 20, width: 80, height: 60 } as DOMRect
const cx = logo.left + logo.width / 2
const cy = logo.top + logo.height / 2

describe('gazeOffset', () => {
  it('is centred when the cursor sits on the logo', () => {
    expect(gazeOffset(cx, cy, logo)).toEqual({ x: 0, y: 0 })
  })

  it('tracks each axis independently, in the right direction', () => {
    expect(gazeOffset(cx + 100, cy, logo).x).toBeCloseTo(100 / GAZE_REACH)
    expect(gazeOffset(cx - 100, cy, logo).x).toBeCloseTo(-100 / GAZE_REACH)
    expect(gazeOffset(cx, cy + 100, logo).y).toBeCloseTo(100 / GAZE_REACH)
    expect(gazeOffset(cx, cy - 100, logo).y).toBeCloseTo(-100 / GAZE_REACH)
  })

  it('never wraps past the logo — a left cursor stays left', () => {
    expect(gazeOffset(cx - 5000, cy, logo).x).toBe(-1)
    expect(gazeOffset(cx + 5000, cy, logo).x).toBe(1)
    expect(gazeOffset(cx, cy + 5000, logo).y).toBe(1)
    expect(gazeOffset(cx, cy - 5000, logo).y).toBe(-1)
  })
})
