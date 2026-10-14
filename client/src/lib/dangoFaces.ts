import { OFFSETS } from './dangoLayout'

export const RESTING = ['normal', 'squint'] as const
export type Resting = (typeof RESTING)[number]

const WEIGHTS: Record<Resting, number> = {
  normal: 0.72,
  squint: 0.28,
}

export const pickResting = (roll = Math.random(), current?: Resting): Resting => {
  let acc = 0
  for (const face of RESTING) {
    acc += WEIGHTS[face]
    if (roll < acc) return face === current ? (face === 'normal' ? 'squint' : 'normal') : face
  }
  return 'normal'
}

export const PET_FACE = 'pet'
export const SLEEP_FACE = 'sleep'

export const IDLE_MS = 6000

export const PETTLE_MS = 420

export const PET_PAD = 0.5

export const SHUFFLE_MS = 3000
export const SHUFFLE_JITTER_MS = 3000

export const WAKE_STAGGER = OFFSETS.map((_, i) => i * 260)

export const NUDGE = { from: OFFSETS.length - 2, to: OFFSETS.length - 1, after: 400 } as const
