import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

function getGitBranch(): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf8',
    }).trim()
  } catch {
    return process.env.VITE_GIT_BRANCH || 'unknown'
  }
}

// Web (GitHub Pages project site): base `/WiseDuty/`
// Native (Capacitor): base `./` — set CAPACITOR_PLATFORM=1 or npm run build:native
export default defineConfig(() => {
  const isCapacitor =
    Boolean(process.env.CAPACITOR_PLATFORM) ||
    process.env.npm_lifecycle_event === 'build:native'
  const base = isCapacitor ? './' : '/WiseDuty/'
  const gitBranch = getGitBranch()

  return {
    base,
    plugins: [react()],
    define: {
      __APP_GIT_BRANCH__: JSON.stringify(gitBranch),
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  }
})
