import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// Use root-relative base for web deploys, but switch to relative paths when building under Capacitor
export default defineConfig(() => {
  const isCapacitor = Boolean(process.env.CAPACITOR_PLATFORM)
  const base = isCapacitor ? './' : '/WiseDuty/'

  return {
    base,
    plugins: [react()],
  }
})
