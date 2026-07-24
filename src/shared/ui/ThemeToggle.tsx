import { useSettings } from '../../features/settings/SettingsContext'
import { IconMoon, IconSun } from './icons'
import './ThemeToggle.css'

/**
 * Theme control: pill switch with sun/moon icons.
 * Light = thumb left (sun active); dark = thumb right (moon active).
 */
export default function ThemeToggle() {
  const { darkMode, toggleDarkMode } = useSettings()
  const mode = darkMode ? 'dark' : 'light'

  return (
    <button
      type="button"
      className="theme-switch"
      data-mode={mode}
      role="switch"
      aria-checked={darkMode}
      aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={toggleDarkMode}
    >
      <span className="theme-switch-track" aria-hidden="true">
        <span className="theme-switch-icon theme-switch-icon-sun">
          <IconSun size={14} />
        </span>
        <span className="theme-switch-icon theme-switch-icon-moon">
          <IconMoon size={14} />
        </span>
      </span>
      <span className="theme-switch-thumb" aria-hidden="true">
        {darkMode ? <IconMoon size={13} /> : <IconSun size={13} />}
      </span>
    </button>
  )
}
