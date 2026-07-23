import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Web (GitHub Pages project site): base `/WiseDuty/`
// Native (Capacitor): base `./` — set CAPACITOR_PLATFORM=1 or npm run build:native
export default defineConfig(() => {
  const isCapacitor =
    Boolean(process.env.CAPACITOR_PLATFORM) ||
    process.env.npm_lifecycle_event === 'build:native'
  const base = isCapacitor ? './' : '/WiseDuty/'

  return {
    base,
    plugins: [react()],
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  }
})
