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

/** Settings — clean cog */
export function IconSettings(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.6 6.5l1.6 1.6M17.8 15.9l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 17.5l1.6-1.6M17.8 8.1l1.6-1.6" />
    </Svg>
  )
}

/** Sun — switch to light mode (shown while dark) */
export function IconSun(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.5 4.5l1.4 1.4M18.1 18.1l1.4 1.4M2.5 12h2M19.5 12h2M4.5 19.5l1.4-1.4M18.1 5.9l1.4-1.4" />
    </Svg>
  )
}

/** Moon — switch to dark mode (shown while light) */
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
