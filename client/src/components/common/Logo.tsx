import React from 'react'
import { useDangoAlive } from '../../hooks/useDangoAnimation'
import { THEME_LOGOS, type ThemeId } from '../../contexts/ThemeContext'
import { VIEWBOX, OFFSETS, SKEWER } from '../../lib/dangoLayout'
import styles from './Logo.module.css'

const INK = '#140f15'

const BODY =
  'm 7,0 c -3.9372984,0 -7.10030437,2.4883888 -7,6 0.13572675,4.751733 5.0802847,4.156395 7,4.156395 1.2538994,0 6.530451,0.392468 6.584946,-4.168088 C 13.622023,2.8853946 10.937298,0 7,0 Z'
const EYE_L =
  'm 4.9623825,3.416 c -0.5858889,0 -0.6520292,2.3368563 -0.024765,2.3368563 0.6604959,0 0.6704653,-2.3368563 0.024765,-2.3368563 z'
const EYE_R =
  'M 8.588001,3.416 C 8.0021121,3.416 7.9359718,5.7528563 8.563236,5.7528563 9.2237319,5.7528563 9.2337013,3.416 8.588001,3.416 Z'
const LINES = {
  pet: 'M 4.85,5.15 Q 5.285,4.0 5.72,5.15 M 8.25,5.15 Q 8.618,4.0 8.99,5.15',
  squint: 'M 4.82,3.9 L 5.6,4.62 L 4.82,5.34 M 9.08,3.9 L 8.3,4.62 L 9.08,5.34',
  sleep: 'M 4.9,4.72 Q 5.285,5.28 5.67,4.72 M 8.25,4.72 Q 8.618,5.28 9.0,4.72',
} as const

type Blink = 'double' | 'slow'
type Motion = 'weight' | 'shift' | 'rock'
type Face = keyof typeof LINES | 'normal'

interface Dango {
  lag: number
  hue: ThemeId
  blink: Blink
  motion: Motion
  glances: boolean
}

const DANGOS: Dango[] = [
  { lag: 0.8, hue: 'iris', blink: 'double', motion: 'weight', glances: false },
  { lag: 1.4, hue: 'sakura', blink: 'slow', motion: 'shift', glances: false },
  { lag: 1, hue: 'mochi', blink: 'slow', motion: 'rock', glances: true },
]

const rand = (min: number, max: number) => min + Math.random() * (max - min)

const PHASES = DANGOS.map(() => ({
  blinkDelay: -rand(0, 9),
  blinkDuration: rand(3.4, 8.6),
  motionDelay: -rand(0, 9),
  motionDuration: rand(5.5, 11),
  glanceDelay: -rand(0, 11),
}))

const BLINK_CLASS: Record<Blink, string> = {
  double: styles.blinkDouble,
  slow: styles.blinkSlow,
}

const MOTION_CLASS: Record<Motion, string> = {
  weight: styles.weight,
  shift: styles.shift,
  rock: styles.rock,
}

const FACE_CLASS: Record<Face, string> = {
  normal: styles.faceNormal,
  pet: styles.facePet,
  squint: styles.faceSquint,
  sleep: styles.faceSleep,
}

const FACES: Face[] = ['normal', 'pet', 'squint', 'sleep']

const HEARTS = [
  { x: 7, y: 4.2, delay: 0, drift: '0px' },
  { x: 9.6, y: 6.4, delay: -0.3, drift: '-0.9px' },
  { x: 4.6, y: 6.1, delay: -0.6, drift: '0.8px' },
  { x: 8.2, y: 3.4, delay: -0.9, drift: '-0.4px' },
] as const

interface LogoProps {
  className?: string
}

const Logo: React.FC<LogoProps> = ({ className }) => {
  const alive = useDangoAlive()

  return (
    <svg
      viewBox={`${VIEWBOX.x} ${VIEWBOX.y} ${VIEWBOX.w} ${VIEWBOX.h}`}
      className={className ? `${styles.logo} ${className}` : styles.logo}
      role="img"
      aria-label="dango"
      data-dango-gaze-origin=""
    >
      <g className={alive ? styles.sway : undefined}>
        <path className={styles.skewer} d={`M ${SKEWER.x1},${SKEWER.y} H ${SKEWER.x2}`} />
        {DANGOS.map((dango, i) => {
          const { x, y } = OFFSETS[i]
          const phase = PHASES[i]
          const { fill, stroke } = THEME_LOGOS[dango.hue]

          const gaze = (
            <g
              data-dango-eye={i}
              className={styles.gaze}
              style={
                { '--gaze-dur': `${(0.12 + dango.lag * 0.18).toFixed(3)}s` } as React.CSSProperties
              }
            >
              {FACES.map((name) => (
                <g key={name} className={`${styles.face} ${FACE_CLASS[name]}`}>
                  <g
                    className={alive && name === 'normal' ? BLINK_CLASS[dango.blink] : undefined}
                    style={
                      alive && name === 'normal'
                        ? {
                            animationDelay: `${phase.blinkDelay}s`,
                            animationDuration: `${phase.blinkDuration}s`,
                          }
                        : undefined
                    }
                  >
                    {name === 'normal' ? (
                      <>
                        <path fill={INK} d={EYE_L} />
                        <path fill={INK} d={EYE_R} />
                      </>
                    ) : (
                      <path className={styles.line} d={LINES[name]} />
                    )}
                  </g>
                </g>
              ))}
            </g>
          )

          return (
            <g key={dango.hue} transform={`translate(${x} ${y})`}>
              <g
                data-dango-face-slot={i}
                data-dango-face="normal"
                className={alive ? MOTION_CLASS[dango.motion] : undefined}
                style={
                  alive
                    ? {
                        animationDelay: `${phase.motionDelay}s`,
                        animationDuration: `${phase.motionDuration}s`,
                      }
                    : undefined
                }
              >
                <path
                  fill={fill}
                  stroke={stroke}
                  strokeWidth="0.9"
                  strokeLinejoin="round"
                  paintOrder="stroke fill"
                  d={BODY}
                />
                <g className={styles.bump}>
                  {alive && dango.glances ? (
                    <g
                      className={styles.glance}
                      style={{ animationDelay: `${phase.glanceDelay}s` }}
                    >
                      {gaze}
                    </g>
                  ) : (
                    gaze
                  )}
                  {alive && (
                    <g>
                      {HEARTS.map((h) => (
                        <text
                          key={h.x}
                          className={styles.heart}
                          x={h.x}
                          y={h.y}
                          fill="var(--color-danger)"
                          style={
                            {
                              '--drift': h.drift,
                              animationDelay: `${h.delay}s`,
                            } as React.CSSProperties
                          }
                        >
                          &#9829;
                        </text>
                      ))}
                    </g>
                  )}
                </g>
              </g>
            </g>
          )
        })}
      </g>
    </svg>
  )
}

export default Logo
