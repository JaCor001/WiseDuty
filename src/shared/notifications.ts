/**
 * Notification port — web uses delayed alerts; native can swap to Capacitor later.
 * Timeouts do not survive backgrounding; documented limitation for P0.
 */

const timers = new Set<ReturnType<typeof setTimeout>>()

export function clearScheduledNotifications(): void {
  timers.forEach((id) => clearTimeout(id))
  timers.clear()
}

function schedule(ms: number, fn: () => void): void {
  const id = setTimeout(() => {
    timers.delete(id)
    fn()
  }, Math.max(0, ms))
  timers.add(id)
}

/**
 * Schedule 10+travel release reminders relative to duty end.
 * Returns false if release time is already in the past (caller should prompt edit).
 */
export function scheduleTravelRestReminders(releaseAt: Date): {
  ok: boolean
  hoursSinceRelease?: number
} {
  const now = new Date()
  if (now > releaseAt) {
    const hoursSinceRelease =
      (now.getTime() - releaseAt.getTime()) / (1000 * 60 * 60)
    return { ok: false, hoursSinceRelease }
  }

  const wants = confirm(
    'Would you like a notification 30 minutes after the release time to remember to confirm the new release time with your company?',
  )
  if (!wants) return { ok: true }

  const timeToFirst =
    releaseAt.getTime() - now.getTime() + 30 * 60 * 1000
  schedule(timeToFirst, () => {
    alert(
      'Reminder: Confirm the new release time with your company (at the hotel room, key in hand or established rest location).',
    )
    schedule(30 * 60 * 1000, () => {
      alert(
        'Follow-up: Please update the release time on the app to reflect the actual time at the rest location.',
      )
    })
  })

  return { ok: true }
}
