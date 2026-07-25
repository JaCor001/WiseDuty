/** Minimal outline icons for header actions (24×24 viewBox). */

import type { ReactNode } from 'react'

type IconProps = {
  size?: number
  className?: string
}

function Svg({
  size = 20,
  className,
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

/**
 * Settings — horizontal sliders (clearly distinct from sun/moon).
 * Reads as “preferences / adjust” without gear rays.
 */
export function IconSettings(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h10" />
      <path d="M18 7h2" />
      <circle cx="16" cy="7" r="2" />
      <path d="M4 17h2" />
      <path d="M10 17h10" />
      <circle cx="8" cy="17" r="2" />
      <path d="M4 12h4" />
      <path d="M12 12h8" />
      <circle cx="10" cy="12" r="2" />
    </Svg>
  )
}

/** Sun — light mode */
export function IconSun(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 3v1.6M12 19.4V21M5.05 5.05l1.15 1.15M17.8 17.8l1.15 1.15M3 12h1.6M19.4 12H21M5.05 18.95l1.15-1.15M17.8 6.2l1.15-1.15" />
    </Svg>
  )
}

/** Moon — dark mode */
export function IconMoon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20.2 14.2A7.6 7.6 0 0 1 9.8 3.8 8.4 8.4 0 1 0 20.2 14.2Z" />
    </Svg>
  )
}

/** Menu / hamburger */
export function IconMenu(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  )
}

/** Close / dismiss */
export function IconClose(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  )
}
