import { VIEWBOX, EYE } from './dangoLayout'

export const GAZE_REACH = 7.5

const clamp = (n: number) => Math.max(-1, Math.min(1, n))

export const gazeAt = (
  clientX: number,
  clientY: number,
  rect: DOMRect,
  offset: { x: number; y: number }
) => {
  const scale = rect.width / VIEWBOX.w
  const dx = (clientX - rect.left) / scale + VIEWBOX.x - offset.x - EYE.x
  const dy = (clientY - rect.top) / scale + VIEWBOX.y - offset.y - EYE.y
  return { x: clamp(dx / GAZE_REACH), y: clamp(dy / GAZE_REACH) }
}
