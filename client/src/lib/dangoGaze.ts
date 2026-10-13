export const GAZE_REACH = 300

export const gazeOffset = (clientX: number, clientY: number, rect: DOMRect) => {
  const clamp = (n: number) => Math.max(-1, Math.min(1, n))
  return {
    x: clamp((clientX - (rect.left + rect.width / 2)) / GAZE_REACH),
    y: clamp((clientY - (rect.top + rect.height / 2)) / GAZE_REACH),
  }
}
