export const RESTING = ['normal', 'squint'] as const
export type Resting = (typeof RESTING)[number]

const WEIGHTS: Record<Resting, number> = {
  normal: 0.64,
  squint: 0.36,
}

export const pickResting = (roll = Math.random()): Resting => {
  let acc = 0
  for (const face of RESTING) {
    acc += WEIGHTS[face]
    if (roll < acc) return face
  }
  return 'normal'
}

export const PET_FACE = 'pet'
export const SLEEP_FACE = 'sleep'

export const IDLE_MS = 6000

export const PETTLE_MS = 420

export const PET_PAD = 0.5

export const WAKE_STAGGER = [0, 260, 520] as const
export const NUDGE = { from: 1, to: 2, after: 200 } as const
