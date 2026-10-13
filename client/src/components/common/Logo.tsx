import React from 'react'
import { useLowEndMode } from '../../contexts/LowEndModeContext'
import { useSetting } from '../../hooks/useSettings'
import { THEME_LOGOS } from '../../contexts/ThemeContext'
import { VIEWBOX, OFFSETS } from '../../lib/dangoLayout'
import styles from './Logo.module.css'

const BODY =
  'm 7,0 c -3.9372984,0 -7.10030437,2.4883888 -7,6 0.13572675,4.751733 5.0802847,4.156395 7,4.156395 1.2538994,0 6.530451,0.392468 6.584946,-4.168088 C 13.622023,2.8853946 10.937298,0 7,0 Z'
const EYE_L =
  'm 4.9623825,3.416 c -0.5858889,0 -0.6520292,2.3368563 -0.024765,2.3368563 0.6604959,0 0.6704653,-2.3368563 0.024765,-2.3368563 z'
const EYE_R =
  'M 8.588001,3.416 C 8.0021121,3.416 7.9359718,5.7528563 8.563236,5.7528563 9.2237319,5.7528563 9.2337013,3.416 8.588001,3.416 Z'
const HAPPY_L = 'M 4.85,5.15 Q 5.285,4.0 5.72,5.15'
const HAPPY_R = 'M 8.25,5.15 Q 8.618,4.0 8.99,5.15'
const SQUINT_L = 'M 4.82,3.9 L 5.6,4.62 L 4.82,5.34'
const SQUINT_R = 'M 9.08,3.9 L 8.3,4.62 L 9.08,5.34'
const SLEEP_L = 'M 4.9,4.72 Q 5.285,5.28 5.67,4.72'
const SLEEP_R = 'M 8.25,4.72 Q 8.618,5.28 9.0,4.72'

type Blink = 'double' | 'slow'
type Motion = 'weight' | 'shift' | 'rock'

interface Dango {
  lag: number
  hue: keyof typeof THEME_LOGOS
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
  const { data: gazeSetting } = useSetting('dangoGaze')
  const { lowEndMode } = useLowEndMode()
  const alive = gazeSetting !== 'false' && !lowEndMode

  const slot = (dango: Dango, i: number, children: React.ReactNode) => {
    const phase = PHASES[i]
    return (
      <g key={dango.hue} transform={`translate(${OFFSETS[i].x} ${OFFSETS[i].y})`}>
        <g
          data-dango-face-slot={i}
          data-face="normal"
          className={alive ? styles[dango.motion] : undefined}
          style={
            alive
              ? {
                  animationDelay: `${phase.motionDelay}s`,
                  animationDuration: `${phase.motionDuration}s`,
                }
              : undefined
          }
        >
          <g data-nudge>{children}</g>
        </g>
      </g>
    )
  }

  const body = (dango: Dango) => (
    <path
      fill={THEME_LOGOS[dango.hue].fill}
      stroke={THEME_LOGOS[dango.hue].stroke}
      strokeWidth="0.9"
      strokeLinejoin="round"
      paintOrder="stroke fill"
      d={BODY}
    />
  )

  const eyes = (dango: Dango, i: number) => {
    const phase = PHASES[i]
    const blinkStyle = alive
      ? { animationDelay: `${phase.blinkDelay}s`, animationDuration: `${phase.blinkDuration}s` }
      : undefined
    const line = (l: string, r: string) => (
      <>
        <path className={styles.line} d={l} />
        <path className={styles.line} d={r} />
      </>
    )

    const face = (name: string, children: React.ReactNode, blinks = true) => (
      <g key={name} className={`${styles.face} ${styles[`face${name}`]}`}>
        <g
          className={alive && blinks ? BLINK_CLASS[dango.blink] : undefined}
          style={blinks ? blinkStyle : undefined}
        >
          {children}
        </g>
      </g>
    )

    const gaze = (
      <g
        className={styles.gaze}
        style={
          {
            '--lag': dango.lag,
            transitionDuration: `${0.1 + dango.lag * 0.18}s`,
          } as React.CSSProperties
        }
      >
        {face(
          'Normal',
          <>
            <path fill="#140f15" d={EYE_L} />
            <path fill="#140f15" d={EYE_R} />
          </>
        )}
        {face('Pet', line(HAPPY_L, HAPPY_R), false)}
        {face('Squint', line(SQUINT_L, SQUINT_R), false)}
        {face('Sleep', line(SLEEP_L, SLEEP_R), false)}
      </g>
    )

    return (
      <>
        {dango.glances ? (
          <g
            className={alive ? styles.glance : undefined}
            style={alive ? { animationDelay: `${phase.glanceDelay}s` } : undefined}
          >
            {gaze}
          </g>
        ) : (
          gaze
        )}
        {alive && (
          <g className={styles.cheer}>
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
      </>
    )
  }

  return (
    <svg
      viewBox={`${VIEWBOX.x} ${VIEWBOX.y} ${VIEWBOX.w} ${VIEWBOX.h}`}
      className={className ? `${styles.logo} ${className}` : styles.logo}
      role="img"
      aria-label="dango"
      data-dango-gaze-origin=""
    >
      {DANGOS.map((dango, i) => slot(dango, i, body(dango)))}
      {DANGOS.map((dango, i) => slot(dango, i, eyes(dango, i)))}
    </svg>
  )
}

export default Logo
