import './VersionBadge.css'

/**
 * Fixed corner badge so you can tell which git branch build you are looking at
 * (local Vite injects live branch; GH Pages shows the branch used at `npm run deploy`).
 */
export default function VersionBadge() {
  const branch =
    typeof __APP_GIT_BRANCH__ === 'string' && __APP_GIT_BRANCH__.length > 0
      ? __APP_GIT_BRANCH__
      : 'unknown'

  return (
    <div className="version-badge" title={`Built from git branch: ${branch}`}>
      <span className="version-badge-label">branch</span>
      <span className="version-badge-value">{branch}</span>
    </div>
  )
}
