export const VIEWBOX = { x: -0.6, y: -2, w: 44.8, h: 14 } as const
export const SPACING = 15
export const BALL = { w: 13.6, h: 10.2 } as const

export const OFFSETS = [
  { x: 0, y: 0.5 },
  { x: SPACING, y: -0.9 },
  { x: SPACING * 2, y: 0.3 },
] as const

export const GAP = SPACING - BALL.w

export const hitTest = (clientX: number, clientY: number, rect: DOMRect, pad = 0): number => {
  if (rect.width <= 0) return -1
  const scale = rect.width / VIEWBOX.w
  const vx = (clientX - rect.left) / scale + VIEWBOX.x
  const vy = (clientY - rect.top) / scale + VIEWBOX.y

  for (let i = 0; i < OFFSETS.length; i++) {
    const lx = vx - OFFSETS[i].x
    const ly = vy - OFFSETS[i].y
    if (lx >= -pad && lx <= BALL.w + pad && ly >= -pad && ly <= BALL.h + pad) return i
  }
  return -1
}
