import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

/**
 * GitHub Pages SPA routing (works with public/404.html).
 * Converts `?/calendar&x=1` → `/WiseDuty/calendar?x=1` (project pages keep 1 segment).
 */
function restoreGitHubPagesPath() {
  const { search, pathname, hash } = window.location
  if (!search.startsWith('?/')) return

  const pathSegmentsToKeep = 1
  const base =
    pathname
      .split('/')
      .slice(0, 1 + pathSegmentsToKeep)
      .join('/') || ''

  // search like ?/calendar&a=b~and~c  or ?/calendar
  const raw = search.slice(2) // drop "?/"
  const amp = raw.indexOf('&')
  const routePart = amp === -1 ? raw : raw.slice(0, amp)
  const queryPart = amp === -1 ? '' : raw.slice(amp + 1).replace(/~and~/g, '&')

  const route = routePart.startsWith('/') ? routePart : `/${routePart}`
  const next = `${base}${route}${queryPart ? `?${queryPart}` : ''}${hash}`
  window.history.replaceState(null, '', next)
}

restoreGitHubPagesPath()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
