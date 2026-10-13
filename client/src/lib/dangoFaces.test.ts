import { describe, it, expect } from 'vitest'
import { pickResting, RESTING, WAKE_STAGGER, NUDGE, IDLE_MS, PETTLE_MS } from './dangoFaces'

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
    expect(normal).toBeGreaterThan(560)
    expect(normal).toBeLessThan(720)
  })
})

describe('wake schedule', () => {
  it('wakes the dangos one after another, never all at once', () => {
    expect(WAKE_STAGGER).toHaveLength(3)
    for (let i = 1; i < WAKE_STAGGER.length; i++) {
      expect(WAKE_STAGGER[i]).toBeGreaterThan(WAKE_STAGGER[i - 1])
    }
  })

  it('nudges a different dango than the one that wakes', () => {
    expect(NUDGE.from).not.toBe(NUDGE.to)
    expect([0, 1, 2]).toContain(NUDGE.to)
  })
})

describe('timings', () => {
  it('settles petted dangos well before the idle sleep kicks in', () => {
    expect(PETTLE_MS).toBeLessThan(IDLE_MS)
  })
})
